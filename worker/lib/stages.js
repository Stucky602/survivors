// Pipeline stages. Each one processes a capped batch, logs a run_log row, and never throws past its own boundary.
import { now, daysFromNow, getSetting, setSetting, startRun, endRun, upsertGameFromSteamSearch, canSpend } from './db.js';
import * as steam from './steam.js';
import * as pp from './platprices.js';
import { runJSON } from './ai.js';
import { MATCH_SYSTEM, matchUser, TAG_SYSTEM, tagUser } from './prompts.js';
import { computeQuality, scoreGame, categorize, needsReview, normalizeFacets, normalizeEvidence, DEFAULT_SETTINGS } from '../../shared/score.js';

const limitOf = (env, override) => Math.max(1, Math.min(200, Number(override) || Number(env.BATCH_LIMIT) || 25));
// A stage stops taking new items after this long so a slow upstream never runs a cron tick into the wall.
const TIME_BUDGET_MS = 40000;
const budgetClock = () => { const t0 = Date.now(); return () => Date.now() - t0 > TIME_BUDGET_MS; };
const MAX_ERRORS = 5;

async function withRun(db, stage, fn) {
  const id = await startRun(db, stage);
  try {
    const r = await fn();
    await endRun(db, id, true, r.count ?? 0, r.note || null);
    return { ok: true, stage, ...r };
  } catch (e) {
    await endRun(db, id, false, 0, e.message || String(e));
    return { ok: false, stage, error: e.message || String(e) };
  }
}

// 1. Discover: walk the Steam search for each configured tag and insert unseen appids.
// Cloudflare's free plan caps a Worker invocation at 50 subrequests, so this does a few pages per call
// and stores a cursor. Click again (or use the ↻ button) to continue; the cron tick resumes it too.
const PAGES_PER_RUN = 6; // 6 pages x however many tags, plus one D1 write each, stays well under 50 fetches
export async function discover(env, opts = {}) {
  return withRun(env.DB, 'discover', async () => {
    const tags = (await getSetting(env.DB, 'steam_tags', [])).filter((t) => t.id);
    const extra = await getSetting(env.DB, 'extra_appids', []);
    const cursor = await getSetting(env.DB, 'discover_cursor', { tag: 0, page: 0 });
    if (opts.reset) { cursor.tag = 0; cursor.page = 0; }
    let added = 0, seen = 0, pagesThisRun = 0, done = false;
    let ti = Math.min(cursor.tag, tags.length);
    let pg = cursor.page;
    while (ti < tags.length && pagesThisRun < PAGES_PER_RUN) {
      const t = tags[ti];
      const { items, total } = await steam.searchByTag(t.id, pg * 50, 50);
      seen += items.length;
      pagesThisRun++;
      for (const it of items) if (await upsertGameFromSteamSearch(env.DB, { ...it, source: `tag:${t.name}` })) added++;
      const lastPage = items.length < 50 || (pg + 1) * 50 >= total;
      if (lastPage) { ti++; pg = 0; } else { pg++; }
      if (pagesThisRun < PAGES_PER_RUN) await steam.pause(250);
    }
    if (ti >= tags.length) { done = true; ti = 0; pg = 0; }
    await setSetting(env.DB, 'discover_cursor', { tag: ti, page: pg });
    // Extra appids only need doing once, when we've finished a full sweep.
    if (done) for (const appid of extra) if (await upsertGameFromSteamSearch(env.DB, { appid: Number(appid), name: `app ${appid}`, source: 'manual' })) added++;
    if (tags.length && seen === 0 && !done) throw new Error('Steam search returned no items; the search HTML may have changed');
    return { count: added, note: done ? `swept all tags, seen ${seen} this pass` : `seen ${seen}, more pages queued (tag ${ti}, page ${pg})` };
  });
}

// 2. Enrich: appdetails + reviews + tag votes for new games, and games not enriched in 7 days.
export async function enrich(env, opts = {}) {
  return withRun(env.DB, 'enrich', async () => {
    const limit = limitOf(env, opts.limit);
    const { results } = await env.DB.prepare(
      `SELECT appid FROM games WHERE (status = 'new' OR (status = 'error' AND COALESCE(error_count,0) < ${MAX_ERRORS} AND (last_enriched IS NULL OR last_enriched < ?)) OR (status = 'enriched' AND (last_enriched IS NULL OR last_enriched < ?)))
       ORDER BY CASE status WHEN 'new' THEN 0 WHEN 'error' THEN 1 ELSE 2 END, last_enriched LIMIT ?`
    ).bind(daysFromNow(-1), daysFromNow(-7), limit).all();
    let n = 0;
    const over = budgetClock();
    for (const { appid } of results) {
      if (over()) break;
      try {
        const d = await steam.appDetails(appid);
        if (!d) { await env.DB.prepare(`UPDATE games SET status = 'excluded', last_error = 'appdetails empty', last_enriched = ? WHERE appid = ?`).bind(now(), appid).run(); continue; }
        if (d.type !== 'game') { await env.DB.prepare(`UPDATE games SET status = 'excluded', last_error = ?, last_enriched = ? WHERE appid = ?`).bind(`type ${d.type}`, now(), appid).run(); continue; }
        const r = await steam.appReviews(appid).catch(() => null);
        const tv = await steam.tagVotes(appid);
        const qs = (r && r.query_summary) || {};
        const genres = (d.genres || []).map((g) => g.description);
        const ea = genres.includes('Early Access') ? 1 : 0;
        const tagVotes = tv ? (tv.find((t) => /bullet heaven/i.test(t.name))?.count ?? 0) : null;
        await env.DB.prepare(
          `UPDATE games SET name = ?, steam_release = ?, coming_soon = ?, developer = ?, publisher = ?, header_img = ?, early_access = ?,
             status = 'enriched', tag_votes = ?, steam_pos = ?, steam_neg = ?, steam_score_desc = ?, last_enriched = ?, last_error = NULL, error_count = 0 WHERE appid = ?`
        ).bind(
          d.name || `app ${appid}`, d.release_date?.date || null, d.release_date?.coming_soon ? 1 : 0,
          (d.developers || []).join(', ') || null, (d.publishers || []).join(', ') || null, d.header_image || null, ea,
          tagVotes, qs.total_positive ?? null, qs.total_negative ?? null, qs.review_score_desc || null, now(), appid
        ).run();
        const slim = {
          name: d.name, short_description: d.short_description, about: steam.stripHtml(d.about_the_game || d.detailed_description),
          release_date: d.release_date, genres, categories: (d.categories || []).map((c) => c.description), metacritic: d.metacritic || null,
          recommendations: d.recommendations || null, platforms: d.platforms || null, is_free: d.is_free || false
        };
        const reviews = r ? { query_summary: qs, reviews: (r.reviews || []).map((x) => ({ voted_up: x.voted_up, votes_up: x.votes_up, hours: Math.round((x.author?.playtime_forever || 0) / 60), text: x.review })) } : null;
        await env.DB.prepare(
          `INSERT INTO steam_cache (appid, appdetails_json, appreviews_json, tag_votes_json, fetched_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(appid) DO UPDATE SET appdetails_json = excluded.appdetails_json, appreviews_json = excluded.appreviews_json, tag_votes_json = excluded.tag_votes_json, fetched_at = excluded.fetched_at`
        ).bind(appid, JSON.stringify(slim), reviews ? JSON.stringify(reviews) : null, tv ? JSON.stringify(tv) : null, now()).run();
        n++;
        await steam.pause(300);
      } catch (e) {
        await env.DB.prepare(`UPDATE games SET status = 'error', last_error = ?, last_enriched = ?, error_count = COALESCE(error_count,0) + 1 WHERE appid = ?`).bind(String(e.message || e).slice(0, 300), now(), appid).run();
        if (/rate-limited/.test(String(e.message))) { await steam.pause(5000); }
      }
    }
    return { count: n };
  });
}

// 3. Match: find the PSN listing for enriched, unmatched games.
export async function match(env, opts = {}) {
  return withRun(env.DB, 'match', async () => {
    const limit = limitOf(env, opts.limit);
    const { results } = await env.DB.prepare(
      `SELECT g.appid, g.name, g.developer, g.publisher, g.steam_release FROM games g
       WHERE g.status = 'enriched' AND g.psn_status IN ('unmatched','not_listed') AND g.ppid IS NULL
         AND (g.next_match_at IS NULL OR g.next_match_at <= ?)
       ORDER BY g.psn_status = 'unmatched' DESC, g.first_seen LIMIT ?`
    ).bind(now(), limit).all();
    let n = 0, skipped = 0;
    const over = budgetClock();
    for (const g of results) {
      if (over()) break;
      if (!(await canSpend(env.DB, 1))) { skipped++; continue; }
      try {
        const cands = (await pp.searchGames(env, g.name)).filter((c) => Number(c.IsDLC) !== 1 && Number(c.IsDemoOrSoundtrack) !== 1);
        if (!cands.length) {
          await env.DB.prepare(`UPDATE games SET psn_status = 'not_listed', next_match_at = ? WHERE appid = ?`).bind(daysFromNow(7), g.appid).run();
          n++; continue;
        }
        const ai = await runJSON(env, { system: MATCH_SYSTEM, user: matchUser({ name: g.name, developer: g.developer, publisher: g.publisher, release: g.steam_release }, cands), maxTokens: 200 });
        const pick = ai.json || {};
        const chosen = cands.find((c) => Number(c.PPID) === Number(pick.ppid));
        const conf = Number(pick.confidence) || 0;
        await env.DB.prepare(`INSERT INTO match_candidates (appid, candidates_json, ai_json, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(appid) DO UPDATE SET candidates_json = excluded.candidates_json, ai_json = excluded.ai_json, created_at = excluded.created_at`)
          .bind(g.appid, JSON.stringify(cands.slice(0, 40)), JSON.stringify(pick), now()).run();
        if (chosen && conf >= 0.9) {
          await acceptMatch(env, g.appid, chosen);
        } else if (chosen && conf >= 0.6) {
          await env.DB.prepare(`UPDATE games SET psn_status = 'review', next_match_at = NULL WHERE appid = ?`).bind(g.appid).run();
        } else {
          await env.DB.prepare(`UPDATE games SET psn_status = 'not_listed', next_match_at = ? WHERE appid = ?`).bind(daysFromNow(7), g.appid).run();
        }
        n++;
      } catch (e) {
        await env.DB.prepare(`UPDATE games SET last_error = ?, next_match_at = ? WHERE appid = ?`).bind(String(e.message || e).slice(0, 300), daysFromNow(1), g.appid).run();
      }
    }
    return { count: n, note: skipped ? `${skipped} skipped, budget reserve` : null };
  });
}

export async function acceptMatch(env, appid, candidate) {
  const row = pp.toProductRow(candidate, appid);
  await pp.upsertProduct(env.DB, row, now());
  await env.DB.prepare(`UPDATE games SET psn_status = 'matched', ppid = ?, concept_id = ?, matched_at = COALESCE(matched_at, ?), next_match_at = NULL, last_error = NULL WHERE appid = ?`)
    .bind(row.ppid, row.concept_id, now(), appid).run();
}

// 4. Refresh: batch price pull for every matched game, 25 ppids per request.
export async function refresh(env, opts = {}) {
  return withRun(env.DB, 'refresh', async () => {
    const { results } = await env.DB.prepare(`SELECT appid, ppid FROM games WHERE ppid IS NOT NULL ORDER BY ppid`).all();
    const byPpid = new Map(results.map((r) => [Number(r.ppid), r.appid]));
    const ppids = [...byPpid.keys()];
    const perCall = 25; // Free plan page size
    const calls = Math.ceil(ppids.length / perCall);
    if (!(await canSpend(env.DB, calls))) return { count: 0, note: `needs ${calls} requests, budget reserve reached` };
    let changed = 0, updated = 0;
    const t = now();
    for (let i = 0; i < ppids.length; i += perCall) {
      const chunk = ppids.slice(i, i + perCall);
      const { data, missing } = await pp.batch(env, chunk);
      if (missing && missing.length) await pp.markDelisted(env.DB, missing.map(Number).filter((x) => byPpid.has(x)), t);
      for (const g of data) {
        const appid = byPpid.get(Number(g.PPID));
        if (!appid) continue;
        if (await pp.upsertProduct(env.DB, pp.toProductRow(g, appid), t)) changed++;
        updated++;
      }
    }
    return { count: updated, note: `${changed} price changes, ${calls} requests` };
  });
}

// 5. Tag: first-pass facets for enriched games with no facets, or whose review count has doubled since tagging.
export async function tag(env, opts = {}) {
  return withRun(env.DB, 'tag', async () => {
    const limit = limitOf(env, opts.limit);
    const settings = { ...DEFAULT_SETTINGS, ...(await getSetting(env.DB, 'taste', {})) };
    const { results } = await env.DB.prepare(
      `SELECT g.appid, g.name, g.developer, g.publisher, g.steam_release, g.early_access, g.steam_pos, g.steam_neg, g.steam_score_desc, g.last_update_seen,
              c.appdetails_json, c.appreviews_json, c.tag_votes_json,
              p.desc AS psn_desc, p.star_rating, p.star_count,
              f.appid AS has_facets, f.reviews_at_tag, f.confirmed_by
       FROM games g LEFT JOIN steam_cache c ON c.appid = g.appid LEFT JOIN psn_products p ON p.ppid = g.ppid LEFT JOIN facets f ON f.appid = g.appid
       WHERE g.status = 'enriched' AND c.appdetails_json IS NOT NULL
         AND (f.appid IS NULL OR (f.confirmed_by IS NULL AND COALESCE(g.steam_pos,0)+COALESCE(g.steam_neg,0) >= 2 * COALESCE(f.reviews_at_tag, 0) + 20))
       ORDER BY g.psn_status = 'matched' DESC, COALESCE(g.steam_pos,0) DESC LIMIT ?`
    ).bind(limit).all();
    let n = 0;
    const over = budgetClock();
    for (const g of results) {
      if (over()) break;
      try {
        const d = JSON.parse(g.appdetails_json || '{}');
        const rv = g.appreviews_json ? JSON.parse(g.appreviews_json) : null;
        const tv = g.tag_votes_json ? JSON.parse(g.tag_votes_json) : [];
        const corpus = {
          name: g.name, developer: g.developer, publisher: g.publisher, steam_release: g.steam_release, early_access: !!g.early_access,
          steam_tags: (tv || []).slice(0, 20), review_summary: rv?.query_summary ? `${rv.query_summary.review_score_desc} (${rv.query_summary.total_positive} positive, ${rv.query_summary.total_negative} negative)` : null,
          short_description: d.short_description, description: d.about, psn_description: g.psn_desc ? steam.stripHtml(g.psn_desc) : null,
          psn_rating: g.star_rating ? `${g.star_rating}/5 from ${g.star_count} ratings` : null,
          reviews: rv?.reviews || []
        };
        const ai = await runJSON(env, { system: TAG_SYSTEM, user: tagUser(corpus), maxTokens: 1600 });
        if (!ai.json || !ai.json.facets) throw new Error('model returned no facets JSON');
        const facets = normalizeFacets(ai.json.facets);
        const evidence = normalizeEvidence(ai.json.evidence);
        const reviewsTotal = (g.steam_pos || 0) + (g.steam_neg || 0);
        const q = computeQuality({ steamPos: g.steam_pos, steamNeg: g.steam_neg, psnRating: g.star_rating, psnCount: g.star_count, abandonedEA: false });
        facets.quality = q.quality;
        const { score } = scoreGame(facets, settings);
        const kevin = (await env.DB.prepare('SELECT owned, never FROM kevin WHERE appid = ?').bind(g.appid).first()) || {};
        const category = categorize(facets, score, q.reviews, kevin, settings);
        const review = needsReview(facets, score, settings) ? 1 : 0;
        if (g.has_facets && g.confirmed_by) {
          await env.DB.prepare(`UPDATE facets SET proposed_json = ?, needs_review = 1 WHERE appid = ?`).bind(JSON.stringify({ facets, evidence, model: ai.model, at: now() }), g.appid).run();
        } else {
          await env.DB.prepare(
            `INSERT INTO facets (appid, version, facets_json, evidence_json, model, tagged_at, reviews_at_tag, needs_review, score, category)
             VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(appid) DO UPDATE SET facets_json = excluded.facets_json, evidence_json = excluded.evidence_json, model = excluded.model,
               tagged_at = excluded.tagged_at, reviews_at_tag = excluded.reviews_at_tag, needs_review = excluded.needs_review, score = excluded.score, category = excluded.category, proposed_json = NULL`
          ).bind(g.appid, JSON.stringify(facets), JSON.stringify(evidence), ai.model, now(), reviewsTotal, review, score, category).run();
        }
        n++;
      } catch (e) {
        await env.DB.prepare(`UPDATE games SET last_error = ? WHERE appid = ?`).bind(`tag: ${String(e.message || e).slice(0, 280)}`, g.appid).run();
      }
    }
    return { count: n };
  });
}

// Rescore everything from stored facets after weights change. No model calls, no API calls.
export async function rescore(env) {
  return withRun(env.DB, 'rescore', async () => {
    const settings = { ...DEFAULT_SETTINGS, ...(await getSetting(env.DB, 'taste', {})) };
    const { results } = await env.DB.prepare(
      `SELECT f.appid, f.facets_json, g.steam_pos, g.steam_neg, p.star_rating, p.star_count, k.owned, k.never
       FROM facets f JOIN games g ON g.appid = f.appid LEFT JOIN psn_products p ON p.ppid = g.ppid LEFT JOIN kevin k ON k.appid = f.appid`
    ).all();
    let n = 0;
    for (const r of results) {
      const facets = JSON.parse(r.facets_json);
      const q = computeQuality({ steamPos: r.steam_pos, steamNeg: r.steam_neg, psnRating: r.star_rating, psnCount: r.star_count });
      facets.quality = q.quality;
      const { score } = scoreGame(facets, settings);
      const category = categorize(facets, score, q.reviews, { owned: r.owned, never: r.never }, settings);
      await env.DB.prepare(`UPDATE facets SET facets_json = ?, score = ?, category = ? WHERE appid = ?`).bind(JSON.stringify(facets), score, category, r.appid).run();
      n++;
    }
    return { count: n };
  });
}

export const STAGES = { discover, enrich, match, refresh, tag, rescore };
