// Survivors worker: API routes, cron stages, and the static site (via the assets binding).
import { STAGES, acceptMatch } from './lib/stages.js';
import { getSetting, setSetting, lastRuns, readBudget, now } from './lib/db.js';
import { isAdmin } from './lib/auth.js';
import * as steam from './lib/steam.js';
import { status as ppStatus } from './lib/platprices.js';
import { DEFAULT_SETTINGS, computeQuality, scoreGame, categorize, normalizeFacets, normalizeEvidence } from '../shared/score.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const bad = (msg, status = 400) => json({ error: msg }, status);

const GAME_SELECT = `
  SELECT g.appid, g.name, g.steam_release, g.coming_soon, g.developer, g.publisher, g.header_img, g.early_access, g.status, g.psn_status, g.ppid,
         g.tag_votes, g.steam_pos, g.steam_neg, g.steam_score_desc, g.last_error,
         p.product_name, p.edition, p.psn_url, p.pp_url, p.img, p.is_ps4, p.is_ps5, p.is_preorder, p.is_delisted, p.is_on_sale,
         p.base_price, p.sale_price, p.plus_price, p.disc_perc, p.discounted_until, p.f_base, p.f_sale, p.f_plus,
         p.star_rating, p.star_count, p.psp_extra, p.psp_premium, p.lowest_ever, p.lowest_seen, p.release_date AS psn_release, p.refreshed_at,
         f.facets_json, f.evidence_json, f.proposed_json, f.score, f.category, f.confirmed_by, f.needs_review, f.tagged_at, f.model,
         k.owned, k.never, k.note
  FROM games g
  LEFT JOIN psn_products p ON p.ppid = g.ppid
  LEFT JOIN facets f ON f.appid = g.appid
  LEFT JOIN kevin k ON k.appid = g.appid`;

function rowToGame(r, full = false) {
  const facets = r.facets_json ? JSON.parse(r.facets_json) : null;
  const out = {
    appid: r.appid, name: r.name, steam_release: r.steam_release, coming_soon: !!r.coming_soon, developer: r.developer, publisher: r.publisher,
    header_img: r.header_img, early_access: !!r.early_access, status: r.status, psn_status: r.psn_status, ppid: r.ppid,
    tag_votes: r.tag_votes, steam_pos: r.steam_pos, steam_neg: r.steam_neg, steam_score_desc: r.steam_score_desc,
    psn: r.ppid ? {
      product_name: r.product_name, edition: r.edition, url: r.psn_url, pp_url: r.pp_url, img: r.img, is_ps4: !!r.is_ps4, is_ps5: !!r.is_ps5,
      is_preorder: !!r.is_preorder, is_delisted: !!r.is_delisted, is_on_sale: !!r.is_on_sale,
      base_price: r.base_price, sale_price: r.sale_price, plus_price: r.plus_price, disc_perc: r.disc_perc, discounted_until: r.discounted_until,
      f_base: r.f_base, f_sale: r.f_sale, f_plus: r.f_plus, star_rating: r.star_rating, star_count: r.star_count,
      psp_extra: !!r.psp_extra, psp_premium: !!r.psp_premium, lowest_ever: r.lowest_ever, lowest_seen: r.lowest_seen, release_date: r.psn_release, refreshed_at: r.refreshed_at
    } : null,
    facets, score: r.score, category: r.category, confirmed: !!r.confirmed_by, needs_review: !!r.needs_review, tagged_at: r.tagged_at,
    owned: !!r.owned, never: !!r.never, note: r.note || ''
  };
  if (full) {
    out.evidence = r.evidence_json ? JSON.parse(r.evidence_json) : null;
    out.proposed = r.proposed_json ? JSON.parse(r.proposed_json) : null;
    out.model = r.model; out.last_error = r.last_error;
  }
  return out;
}

async function listGames(env, view) {
  let where = `g.status = 'enriched'`;
  if (view === 'upcoming') where += ` AND (g.psn_status IN ('unmatched','not_listed','review') OR p.is_preorder = 1)`;
  else if (view === 'sale') where += ` AND p.is_on_sale = 1 AND COALESCE(p.is_delisted,0) = 0`;
  else if (view === 'catalog') where += ` AND g.psn_status = 'matched' AND COALESCE(p.is_delisted,0) = 0`;
  const { results } = await env.DB.prepare(`${GAME_SELECT} WHERE ${where} ORDER BY COALESCE(f.score, -1) DESC, g.name`).all();
  return results.map((r) => rowToGame(r));
}

async function handleApi(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, '');
  const m = request.method;

  if (path === '/health') return json({ ok: true, time: now() });

  if (m === 'GET' && path === '/games') return json({ games: await listGames(env, url.searchParams.get('view') || 'catalog') });

  if (m === 'GET' && /^\/game\/\d+$/.test(path)) {
    const appid = Number(path.split('/')[2]);
    const r = await env.DB.prepare(`${GAME_SELECT} WHERE g.appid = ?`).bind(appid).first();
    if (!r) return bad('not found', 404);
    const snaps = r.ppid ? (await env.DB.prepare('SELECT observed_at, base_price, sale_price, plus_price FROM price_snapshots WHERE ppid = ? ORDER BY observed_at').bind(r.ppid).all()).results : [];
    const cache = await env.DB.prepare('SELECT appdetails_json, tag_votes_json FROM steam_cache WHERE appid = ?').bind(appid).first();
    const d = cache?.appdetails_json ? JSON.parse(cache.appdetails_json) : null;
    return json({ game: rowToGame(r, true), price_history: snaps, steam: d ? { short_description: d.short_description, genres: d.genres, categories: d.categories, metacritic: d.metacritic } : null, tags: cache?.tag_votes_json ? JSON.parse(cache.tag_votes_json).slice(0, 15) : [] });
  }

  if (m === 'GET' && path === '/meta') {
    const taste = { ...DEFAULT_SETTINGS, ...(await getSetting(env.DB, 'taste', {})) };
    const counts = await env.DB.prepare(
      `SELECT SUM(status='enriched') AS enriched, SUM(status='new') AS pending, SUM(psn_status='matched') AS matched, SUM(psn_status='not_listed') AS not_listed, SUM(psn_status='review') AS review, COUNT(*) AS total FROM games`
    ).first();
    const lastRefresh = await env.DB.prepare('SELECT MAX(refreshed_at) AS t FROM psn_products').first();
    return json({ taste, counts, runs: await lastRuns(env.DB), budget: await readBudget(env.DB), last_refresh: lastRefresh?.t || null, region: env.REGION || 'US' });
  }

  // Everything below is admin.
  if (!isAdmin(request, env)) return bad('admin token required', 401);
  const body = m === 'GET' ? {} : await request.json().catch(() => ({}));

  if (path === '/admin/whoami') return json({ admin: true });

  if (m === 'POST' && /^\/admin\/run\/\w+$/.test(path)) {
    const stage = path.split('/')[3];
    const fn = STAGES[stage];
    if (!fn) return bad(`unknown stage ${stage}`);
    return json(await fn(env, body));
  }

  if (m === 'GET' && path === '/admin/queue') {
    const matches = (await env.DB.prepare(
      `SELECT g.appid, g.name, g.developer, g.publisher, g.steam_release, g.header_img, mc.candidates_json, mc.ai_json FROM games g JOIN match_candidates mc ON mc.appid = g.appid WHERE g.psn_status = 'review' ORDER BY g.name`
    ).all()).results.map((r) => ({ appid: r.appid, name: r.name, developer: r.developer, publisher: r.publisher, steam_release: r.steam_release, header_img: r.header_img, candidates: JSON.parse(r.candidates_json || '[]'), ai: JSON.parse(r.ai_json || '{}') }));
    const facets = (await env.DB.prepare(`${GAME_SELECT} WHERE f.needs_review = 1 ORDER BY f.score DESC`).all()).results.map((r) => rowToGame(r, true));
    const errors = (await env.DB.prepare(`SELECT appid, name, status, psn_status, last_error FROM games WHERE last_error IS NOT NULL ORDER BY last_enriched DESC LIMIT 100`).all()).results;
    return json({ matches, facets, errors });
  }

  if (m === 'POST' && path === '/admin/match') {
    const { appid, ppid } = body;
    if (!appid) return bad('appid required');
    if (ppid == null) {
      await env.DB.prepare(`UPDATE games SET psn_status = 'not_listed', next_match_at = ?, ppid = NULL WHERE appid = ?`).bind(new Date(Date.now() + 30 * 864e5).toISOString(), appid).run();
      return json({ ok: true, psn_status: 'not_listed' });
    }
    const mc = await env.DB.prepare('SELECT candidates_json FROM match_candidates WHERE appid = ?').bind(appid).first();
    const cand = mc ? JSON.parse(mc.candidates_json).find((c) => Number(c.PPID) === Number(ppid)) : null;
    if (!cand) return bad('ppid not in candidate list; re-run match');
    await acceptMatch(env, appid, cand);
    return json({ ok: true, psn_status: 'matched' });
  }

  if (m === 'POST' && path === '/admin/facets') {
    const { appid, facets, evidence, reject } = body;
    if (!appid) return bad('appid required');
    if (reject) { await env.DB.prepare(`UPDATE facets SET needs_review = 0, proposed_json = NULL WHERE appid = ?`).bind(appid).run(); return json({ ok: true }); }
    const settings = { ...DEFAULT_SETTINGS, ...(await getSetting(env.DB, 'taste', {})) };
    const g = await env.DB.prepare(`SELECT g.steam_pos, g.steam_neg, p.star_rating, p.star_count, k.owned, k.never FROM games g LEFT JOIN psn_products p ON p.ppid = g.ppid LEFT JOIN kevin k ON k.appid = g.appid WHERE g.appid = ?`).bind(appid).first();
    const f = normalizeFacets(facets);
    const q = computeQuality({ steamPos: g?.steam_pos, steamNeg: g?.steam_neg, psnRating: g?.star_rating, psnCount: g?.star_count });
    f.quality = q.quality;
    const { score } = scoreGame(f, settings);
    const category = categorize(f, score, q.reviews, g || {}, settings);
    await env.DB.prepare(
      `INSERT INTO facets (appid, version, facets_json, evidence_json, tagged_at, confirmed_by, confirmed_at, needs_review, score, category) VALUES (?, 1, ?, ?, ?, 'kevin', ?, 0, ?, ?)
       ON CONFLICT(appid) DO UPDATE SET facets_json = excluded.facets_json, evidence_json = COALESCE(excluded.evidence_json, facets.evidence_json), confirmed_by = 'kevin', confirmed_at = excluded.confirmed_at, needs_review = 0, proposed_json = NULL, score = excluded.score, category = excluded.category`
    ).bind(appid, JSON.stringify(f), evidence ? JSON.stringify(normalizeEvidence(evidence)) : null, now(), now(), score, category).run();
    return json({ ok: true, score, category });
  }

  if (m === 'POST' && path === '/admin/kevin') {
    const { appid, owned, never, note } = body;
    if (!appid) return bad('appid required');
    await env.DB.prepare(`INSERT INTO kevin (appid, owned, never, note, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(appid) DO UPDATE SET owned = excluded.owned, never = excluded.never, note = excluded.note, updated_at = excluded.updated_at`)
      .bind(appid, owned ? 1 : 0, never ? 1 : 0, note || null, now()).run();
    return json({ ok: true });
  }

  if (m === 'GET' && path === '/admin/settings') {
    return json({ taste: { ...DEFAULT_SETTINGS, ...(await getSetting(env.DB, 'taste', {})) }, steam_tags: await getSetting(env.DB, 'steam_tags', []), extra_appids: await getSetting(env.DB, 'extra_appids', []) });
  }
  if (m === 'PUT' && path === '/admin/settings') {
    if (body.taste) await setSetting(env.DB, 'taste', body.taste);
    if (body.steam_tags) await setSetting(env.DB, 'steam_tags', body.steam_tags);
    if (body.extra_appids) await setSetting(env.DB, 'extra_appids', body.extra_appids.map(Number).filter(Boolean));
    return json({ ok: true });
  }

  if (m === 'POST' && path === '/admin/resolve-tag') {
    const id = await steam.resolveTagId(body.name || 'Bullet Heaven').catch(() => null);
    return json({ name: body.name, id, note: id ? null : 'could not read the tag id from the Steam tag page; paste it by hand from the URL of a tag search' });
  }

  if (m === 'GET' && path === '/admin/budget') {
    const local = await readBudget(env.DB);
    let remote = null;
    try { remote = await ppStatus(env); } catch (e) { remote = { error: e.message }; }
    return json({ local, remote });
  }

  return bad('no such route', 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try { return await handleApi(request, env, ctx); } catch (e) { return bad(e.message || String(e), 500); }
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    const plan = {
      '0 9 * * *': ['discover', 'refresh'],
      '30 9 * * *': ['enrich', 'match', 'tag'],
      '0 21 * * *': ['enrich', 'match', 'tag']
    };
    const stages = plan[event.cron] || ['enrich', 'match', 'tag'];
    ctx.waitUntil((async () => { for (const s of stages) await STAGES[s](env, {}); })());
  }
};
