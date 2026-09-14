// Survivors worker: API routes, cron stages, and the static site (via the assets binding).
import { STAGES, acceptMatch, aiCapped, planDebug, planMethod } from './lib/stages.js';
import { Runner, pickStage } from './lib/runner.js';
import { claudeSpend } from './lib/ai.js';
export { Runner };
import { getSetting, setSetting, lastRuns, readBudget, syncBudgetFromStatus, now } from './lib/db.js';
import { isAdmin } from './lib/auth.js';
import * as steam from './lib/steam.js';
import { status as ppStatus, batch as ppBatch } from './lib/platprices.js';
import { canSpend } from './lib/db.js';
import { DEFAULT_SETTINGS, computeQuality, scoreGame, categorize, normalizeFacets, normalizeEvidence } from '../shared/score.js';

const SEC_HEADERS = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin', 'x-frame-options': 'DENY', 'cache-control': 'no-store' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...SEC_HEADERS } });
const bad = (msg, status = 400) => json({ error: msg }, status);

const GAME_SELECT = `
  SELECT g.appid, g.name, g.steam_release, g.coming_soon, g.developer, g.publisher, g.header_img, g.early_access, g.status, g.psn_status, g.ppid,
         g.tag_votes, g.steam_pos, g.steam_neg, g.steam_score_desc, g.last_error,
         p.product_name, p.edition, p.psn_url, p.pp_url, p.img, p.is_ps4, p.is_ps5, p.is_preorder, p.is_delisted, p.is_on_sale,
         p.base_price, p.sale_price, p.plus_price, p.disc_perc, p.discounted_until, p.f_base, p.f_sale, p.f_plus,
         p.star_rating, p.star_count, p.psp_extra, p.psp_premium, p.lowest_ever, p.lowest_seen, p.release_date AS psn_release, p.refreshed_at,
         f.facets_json, f.evidence_json, f.proposed_json, f.score, f.category, f.confirmed_by, f.needs_review, f.tagged_at, f.model,
         k.owned, k.never, k.note, k.want, k.want_price, k.want_at, k.verdict, g.matched_at,
         g.ps5_plan, g.ps5_plan_date, g.ps5_plan_window, g.ps5_plan_note, g.ps5_plan_platform, g.ps5_plan_at,
         g.review_hours_median, g.players_now, g.players_at, g.ps5_plan_url, g.ps5_plan_method
  FROM games g
  LEFT JOIN psn_products p ON p.ppid = g.ppid
  LEFT JOIN facets f ON f.appid = g.appid
  LEFT JOIN kevin k ON k.appid = g.appid`;

const nowStamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
function rowToGame(r, full = false) {
  const facets = r.facets_json ? JSON.parse(r.facets_json) : null;
  // A sale past its end date is over, whatever the last refresh said.
  const saleLive = !!r.is_on_sale && (!r.discounted_until || String(r.discounted_until) >= nowStamp());
  const out = {
    appid: r.appid, name: r.name, steam_release: r.steam_release, coming_soon: !!r.coming_soon, developer: r.developer, publisher: r.publisher,
    header_img: r.header_img, early_access: !!r.early_access, status: r.status, psn_status: r.psn_status, ppid: r.ppid,
    tag_votes: r.tag_votes, steam_pos: r.steam_pos, steam_neg: r.steam_neg, steam_score_desc: r.steam_score_desc,
    psn: r.ppid ? {
      product_name: r.product_name, edition: r.edition, url: r.psn_url, pp_url: r.pp_url, img: r.img, is_ps4: !!r.is_ps4, is_ps5: !!r.is_ps5,
      is_preorder: !!r.is_preorder, is_delisted: !!r.is_delisted, is_on_sale: saleLive, sale_expired: !!r.is_on_sale && !saleLive,
      base_price: r.base_price, sale_price: r.sale_price, plus_price: r.plus_price, disc_perc: r.disc_perc, discounted_until: r.discounted_until,
      f_base: r.f_base, f_sale: r.f_sale, f_plus: r.f_plus, star_rating: r.star_rating, star_count: r.star_count,
      psp_extra: !!r.psp_extra, psp_premium: !!r.psp_premium, lowest_ever: r.lowest_ever, lowest_seen: r.lowest_seen, release_date: r.psn_release, refreshed_at: r.refreshed_at
    } : null,
    facets, score: r.score, category: r.category, confirmed: !!r.confirmed_by, needs_review: !!r.needs_review, tagged_at: r.tagged_at,
    owned: !!r.owned, never: !!r.never, note: r.note || '', want: !!r.want, want_price: r.want_price, want_at: r.want_at, verdict: r.verdict || null, matched_at: r.matched_at,
    hours_median: r.review_hours_median, players_now: r.players_now, players_at: r.players_at,
    ps5_plan: r.ps5_plan_at ? { status: r.ps5_plan || 'unknown', platform: r.ps5_plan_platform || 'unspecified', date: r.ps5_plan_date, window: r.ps5_plan_window, note: r.ps5_plan_note, url: r.ps5_plan_url, method: r.ps5_plan_method, at: r.ps5_plan_at } : null
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
  if (view === 'upcoming') where += ` AND (p.is_preorder = 1 OR (g.ppid IS NULL AND g.coming_soon = 1))`;
  else if (view === 'steamonly') where += ` AND g.ppid IS NULL AND COALESCE(g.coming_soon,0) = 0`;
  else if (view === 'sale') where += ` AND p.is_on_sale = 1 AND COALESCE(p.is_delisted,0) = 0 AND (p.discounted_until IS NULL OR p.discounted_until >= '${new Date().toISOString().replace('T', ' ').slice(0, 19)}')`;
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
    const cache = await env.DB.prepare('SELECT appdetails_json, appreviews_json, tag_votes_json FROM steam_cache WHERE appid = ?').bind(appid).first();
    const d = cache?.appdetails_json ? JSON.parse(cache.appdetails_json) : null;
    const rv = cache?.appreviews_json ? JSON.parse(cache.appreviews_json) : null;
    const reviews = rv ? (rv.reviews || []).slice().sort((a, b) => (b.votes_up || 0) - (a.votes_up || 0)).slice(0, 4).map((x) => ({ voted_up: x.voted_up, hours: x.hours, text: String(x.text || '').slice(0, 600) })) : [];
    return json({ game: rowToGame(r, isAdmin(request, env)), price_history: snaps, steam: d ? { short_description: d.short_description, about: (d.about || '').slice(0, 1500), genres: d.genres, categories: d.categories, metacritic: d.metacritic } : null, tags: cache?.tag_votes_json ? JSON.parse(cache.tag_votes_json).slice(0, 15) : [], reviews });
  }

  if (m === 'GET' && path === '/meta') {
    // Public: catalog counts, the taste weights the pages score with, price freshness. Nothing operational.
    const taste = { ...DEFAULT_SETTINGS, ...(await getSetting(env.DB, 'taste', {})) };
    const counts = await env.DB.prepare(
      `SELECT SUM(status='enriched') AS enriched, SUM(psn_status='matched') AS matched, SUM(psn_status='not_listed') AS not_listed, COUNT(*) AS total,
              (SELECT COUNT(*) FROM facets) AS tagged,
              (SELECT COUNT(*) FROM psn_products WHERE is_on_sale = 1 AND COALESCE(is_delisted,0) = 0 AND (discounted_until IS NULL OR discounted_until >= '${nowStamp()}')) AS on_sale
       FROM games`
    ).first();
    const lastRefresh = await env.DB.prepare('SELECT MAX(refreshed_at) AS t FROM psn_products').first();
    const ageH = lastRefresh?.t ? (Date.now() - Date.parse(lastRefresh.t)) / 36e5 : null;
    return json({ taste, counts, last_refresh: lastRefresh?.t || null, prices_stale: ageH != null && ageH > 48, region: env.REGION || 'US' });
  }

  if (m === 'GET' && path === '/home') {
    const since = url.searchParams.get('since') || new Date(Date.now() - 7 * 864e5).toISOString();
    const nowTs = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const in3 = new Date(Date.now() + 3 * 864e5).toISOString().replace('T', ' ').slice(0, 19);
    const in30 = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
    const q = async (where, order, limit) => (await env.DB.prepare(`${GAME_SELECT} WHERE g.status = 'enriched' AND ${where} ORDER BY ${order} LIMIT ${limit}`).all()).results.map((r) => rowToGame(r));
    const ending = await q(`p.is_on_sale = 1 AND COALESCE(p.is_delisted,0) = 0 AND p.discounted_until BETWEEN '${nowTs}' AND '${in3}' AND COALESCE(k.owned,0) = 0`, 'p.discounted_until, COALESCE(f.score,-1) DESC', 20);
    const live = `(p.discounted_until IS NULL OR p.discounted_until >= '${nowTs}')`;
    const newSales = await q(`p.is_on_sale = 1 AND ${live} AND COALESCE(p.is_delisted,0) = 0 AND COALESCE(k.owned,0) = 0 AND EXISTS (SELECT 1 FROM price_snapshots s WHERE s.ppid = p.ppid AND s.observed_at > ? AND s.sale_price IS NOT NULL)`.replace('?', `'${since.replace(/'/g, '')}'`), 'COALESCE(f.score,-1) DESC', 30);
    const newOnPsn = await q(`g.matched_at > '${since.replace(/'/g, '')}' AND COALESCE(k.owned,0) = 0`, 'g.matched_at DESC', 30);
    const releasing = await q(`p.is_preorder = 1 AND p.release_date <= '${in30}'`, 'p.release_date', 20);
    const wanted = await q(`k.want = 1`, 'p.is_on_sale DESC, COALESCE(f.score,-1) DESC', 50);
    const picks = await q(`g.psn_status = 'matched' AND COALESCE(p.is_delisted,0) = 0 AND COALESCE(k.owned,0) = 0 AND COALESCE(k.never,0) = 0 AND f.score IS NOT NULL AND f.category != 'do_not_recommend'`, 'f.score DESC', 8);
    const drops = await q(`k.want = 1 AND k.want_price IS NOT NULL AND p.sale_price < k.want_price AND ${live}`, 'p.sale_price', 20);
    const rel = (await env.DB.prepare(`SELECT steam_release, psn_status FROM games WHERE status = 'enriched' AND steam_release IS NOT NULL`).all()).results;
    const rollPool = await q(`g.psn_status = 'matched' AND COALESCE(p.is_delisted,0) = 0 AND COALESCE(k.owned,0) = 0 AND COALESCE(k.never,0) = 0 AND f.score >= 55`, 'f.score DESC', 60);
    return json({ since, ending, newSales, newOnPsn, releasing, wanted, picks, drops, releases: rel, rollPool });
  }

  // Everything below is admin.
  if (!isAdmin(request, env)) return bad('admin token required', 401);
  const body = m === 'GET' ? {} : await request.json().catch(() => ({}));

  if (path === '/admin/whoami') return json({ admin: true });

  if (m === 'GET' && path === '/admin/meta') {
    const counts = await env.DB.prepare(
      `SELECT SUM(status='new') AS pending, SUM(status='error') AS errors, SUM(psn_status='review') AS review,
              (SELECT COUNT(*) FROM facets WHERE needs_review = 1) AS facets_review,
              (SELECT COUNT(*) FROM facets WHERE model LIKE 'claude%') AS tagged_claude,
              (SELECT COUNT(*) FROM facets WHERE reviews_at_tag < 0 AND confirmed_by IS NULL) AS retag_pending
       FROM games`
    ).first();
    const taste = { ...DEFAULT_SETTINGS, ...(await getSetting(env.DB, 'taste', {})) };
    const th = Number(taste.match_min_score) || 0;
    counts.below_match_threshold = th > 0 ? (await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM games g LEFT JOIN facets f ON f.appid = g.appid LEFT JOIN kevin k ON k.appid = g.appid
       WHERE g.status = 'enriched' AND g.psn_status IN ('unmatched','not_listed') AND g.ppid IS NULL AND COALESCE(k.want,0) = 0 AND f.score IS NOT NULL AND f.score < ${th}`
    ).first()).n : 0;
    return json({ counts, match_min_score: th, runs: await lastRuns(env.DB), budget: await readBudget(env.DB), has_platprices_key: !!env.PLATPRICES_KEY, plan: String(env.PLAN || 'free').toLowerCase(),
      plan_method: planMethod(env), tagger: env.ANTHROPIC_API_KEY ? (env.CLAUDE_MODEL || 'claude-haiku-4-5') : (env.AI_MODEL || 'workers-ai'), ai_capped_until: (await aiCapped(env)) ? await getSetting(env.DB, 'ai_capped_until', null) : null });
  }

  if (m === 'POST' && /^\/admin\/run\/[\w-]+$/.test(path)) {
    const stage = path.split('/')[3];
    const fn = STAGES[stage];
    if (!fn) return bad(`unknown stage ${stage}`);
    return json(await fn(env, body));
  }

  // The Runner: start drains everything, stop halts it, status reports.
  if (/^\/admin\/runner\/(start|stop|status)$/.test(path)) {
    if (!env.RUNNER) return bad('runner binding not configured', 501);
    const id = env.RUNNER.idFromName('main');
    const scope = ['all', 'available', 'upcoming'].includes(body.scope) ? body.scope : 'all';
    const r = await env.RUNNER.get(id).fetch(new Request(`https://runner${path}?scope=${scope}`));
    const d = await r.json();
    if (path.endsWith('status')) { d.pending = await pickStage(env); d.claude = env.ANTHROPIC_API_KEY ? await claudeSpend(env) : null; d.ai_capped_until = (await aiCapped(env)) ? await getSetting(env.DB, 'ai_capped_until', null) : null; }
    return json(d);
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

  // Hand-set a PS5 plan when you know better than the news feed.
  if (m === 'POST' && path === '/admin/plan') {
    const { appid, status, date, window, note, platform } = body;
    if (!appid) return bad('appid required');
    await env.DB.prepare(`UPDATE games SET ps5_plan = ?, ps5_plan_date = ?, ps5_plan_window = ?, ps5_plan_note = ?, ps5_plan_platform = ?, ps5_plan_at = ? WHERE appid = ?`)
      .bind(status || 'unknown', date || null, window || null, note || null, ['ps5', 'ps4', 'both'].includes(platform) ? platform : 'unspecified', now(), appid).run();
    return json({ ok: true });
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
    const { appid, owned, never, note, want, verdict } = body;
    if (!appid) return bad('appid required');
    const prev = (await env.DB.prepare('SELECT * FROM kevin WHERE appid = ?').bind(appid).first()) || {};
    const prod = await env.DB.prepare('SELECT p.sale_price FROM games g JOIN psn_products p ON p.ppid = g.ppid WHERE g.appid = ?').bind(appid).first();
    const wantNow = want == null ? !!prev.want : !!want;
    const wantPrice = wantNow ? (prev.want && prev.want_price != null ? prev.want_price : (prod?.sale_price ?? null)) : null;
    const wantAt = wantNow ? (prev.want ? prev.want_at : now()) : null;
    const v = verdict === undefined ? (prev.verdict || null) : (['loved', 'fine', 'bounced'].includes(verdict) ? verdict : null);
    await env.DB.prepare(`INSERT INTO kevin (appid, owned, never, note, want, want_price, want_at, verdict, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(appid) DO UPDATE SET owned = excluded.owned, never = excluded.never, note = excluded.note, want = excluded.want, want_price = excluded.want_price, want_at = excluded.want_at, verdict = excluded.verdict, updated_at = excluded.updated_at`)
      .bind(appid, (owned == null ? !!prev.owned : !!owned) ? 1 : 0, (never == null ? !!prev.never : !!never) ? 1 : 0, note === undefined ? (prev.note || null) : (note || null), wantNow ? 1 : 0, wantPrice, wantAt, v, now()).run();
    return json({ ok: true });
  }

  // Attach a PSN product by PlatPrices id when the matcher missed. Spends one PlatPrices request.
  if (m === 'POST' && path === '/admin/attach') {
    const { appid, ppid } = body;
    if (!appid || !ppid) return bad('appid and ppid required');
    if (!(await canSpend(env.DB, 1))) return bad('PlatPrices budget reserve reached; try next month', 429);
    const { data } = await ppBatch(env, [Number(ppid)]);
    if (!data.length) return bad('PlatPrices has no product with that ppid in this region', 404);
    await acceptMatch(env, appid, data[0]);
    return json({ ok: true, product: data[0].ProductName });
  }

  if (m === 'GET' && path === '/admin/plan-stats') {
    const by = (await env.DB.prepare(`SELECT COALESCE(ps5_plan,'(unread)') AS status, COALESCE(ps5_plan_method,'') AS method, COUNT(*) AS n FROM games WHERE status = 'enriched' AND ppid IS NULL GROUP BY 1, 2 ORDER BY n DESC`).all()).results;
    const news = await env.DB.prepare(`SELECT SUM(c.news_json IS NULL) AS missing, SUM(c.news_json = '[]') AS empty, SUM(c.news_json IS NOT NULL AND c.news_json != '[]') AS has_news, COUNT(*) AS total FROM games g LEFT JOIN steam_cache c ON c.appid = g.appid WHERE g.status = 'enriched'`).first();
    return json({ method: planMethod(env), by_status: by, news });
  }
  if (m === 'GET' && path === '/admin/plan-debug') {
    const appid = Number(url.searchParams.get('appid'));
    if (!appid) return bad('appid required');
    return json(await planDebug(env, appid));
  }

  if (m === 'GET' && path === '/admin/calibration') {
    const { results } = await env.DB.prepare(`SELECT g.appid, g.name, f.score, f.category, k.verdict, k.owned FROM kevin k JOIN games g ON g.appid = k.appid LEFT JOIN facets f ON f.appid = k.appid WHERE k.verdict IS NOT NULL ORDER BY f.score DESC`).all();
    return json({ rows: results });
  }

  if (m === 'GET' && path === '/admin/settings') {
    return json({ taste: { ...DEFAULT_SETTINGS, ...(await getSetting(env.DB, 'taste', {})) }, steam_tags: await getSetting(env.DB, 'steam_tags', []), extra_appids: await getSetting(env.DB, 'extra_appids', []), review_mode: await getSetting(env.DB, 'review_mode', 'auto') });
  }
  if (m === 'PUT' && path === '/admin/settings') {
    if (body.taste) await setSetting(env.DB, 'taste', body.taste);
    if (body.review_mode) await setSetting(env.DB, 'review_mode', body.review_mode === 'hybrid' ? 'hybrid' : 'auto');
    if (body.steam_tags) await setSetting(env.DB, 'steam_tags', body.steam_tags);
    if (body.extra_appids) await setSetting(env.DB, 'extra_appids', body.extra_appids.map(Number).filter(Boolean));
    return json({ ok: true });
  }

  if (m === 'POST' && path === '/admin/resolve-tag') {
    const id = await steam.resolveTagId(body.name || 'Bullet Heaven').catch(() => null);
    return json({ name: body.name, id, note: id ? null : 'could not read the tag id from the Steam tag page; paste it by hand from the URL of a tag search' });
  }

  if (m === 'GET' && path === '/admin/budget') {
    let remote = null, synced = false;
    try { remote = await ppStatus(env); synced = await syncBudgetFromStatus(env.DB, remote); } catch (e) { remote = { error: e.message }; }
    const local = await readBudget(env.DB);
    return json({ local, remote, synced });
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
    // One cheap stage per tick (stays under the 50-subrequest cap), then hand the rest to the Runner,
    // which drains enrich/match/tag one batch per alarm in fresh invocations.
    ctx.waitUntil((async () => {
      if (event.cron === '0 9 * * *') { await STAGES.discover(env, {}); await STAGES.refresh(env, {}); }
      if (env.RUNNER) {
        const id = env.RUNNER.idFromName('main');
        await env.RUNNER.get(id).fetch(new Request('https://runner/start'));
      } else {
        const s = await pickStage(env);
        if (s) await STAGES[s](env, {});
      }
    })());
  }
};
