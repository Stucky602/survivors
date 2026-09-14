// Pipeline stages. Each one processes a capped batch, logs a run_log row, and never throws past its own boundary.
import { now, daysFromNow, getSetting, setSetting, startRun, endRun, upsertGameFromSteamSearch, canSpend } from './db.js';
import * as steam from './steam.js';
import * as pp from './platprices.js';
import { syncBudgetFromStatus } from './db.js';
import { runJSON, runClaude, isCapError } from './ai.js';
import { MATCH_SYSTEM, matchUser, TAG_SYSTEM, tagUser, PLAN_SYSTEM, planUser, PLAN_WEB_SYSTEM, planWebUser } from './prompts.js';
import { computeQuality, scoreGame, categorize, needsReview, normalizeFacets, normalizeEvidence, DEFAULT_SETTINGS } from '../../shared/score.js';

// PLAN=free keeps every stage under Cloudflare's 50-subrequest-per-invocation cap. PLAN=paid (Workers Paid, 1,000) runs big.
export const isPaid = (env) => String(env.PLAN || 'free').toLowerCase() === 'paid';
// On Paid the batch is BATCH_LIMIT_PAID (default 100); BATCH_LIMIT only applies on Free so a stale "12" cannot throttle a paid account.
const limitOf = (env, override) => {
  const paid = isPaid(env);
  const base = paid ? (Number(env.BATCH_LIMIT_PAID) || 100) : (Number(env.BATCH_LIMIT) || 12);
  return Math.max(1, Math.min(paid ? 400 : 200, Number(override) || base));
};
// Scope: which games a run touches. 'all' | 'available' (out on Steam or PSN) | 'upcoming' (not out anywhere).
export const SCOPES = ['all', 'available', 'upcoming'];
export const scopeSql = (scope, g = 'g') => scope === 'available' ? ` AND COALESCE(${g}.coming_soon,0) = 0` : scope === 'upcoming' ? ` AND ${g}.coming_soon = 1` : '';
const scopeOf = (opts) => (SCOPES.includes(opts && opts.scope) ? opts.scope : 'all');
// A stage stops taking new items after this long so a slow upstream never runs a cron tick into the wall.
const timeBudget = (env) => (isPaid(env) ? 150000 : 40000); // wall-clock per batch
const budgetClock = (env) => { const t0 = Date.now(); const lim = timeBudget(env); return () => Date.now() - t0 > lim; };
const MAX_ERRORS = 5;
// Workers AI free allocation resets at 00:00 UTC. When a stage hits it, park the AI stages until then.
const nextUtcMidnight = () => { const d = new Date(); d.setUTCHours(24, 0, 0, 0); return d.toISOString(); };
async function markAiCapped(env) { await setSetting(env.DB, 'ai_capped_until', nextUtcMidnight()); }
export async function aiCapped(env) { const u = await getSetting(env.DB, 'ai_capped_until', null); return !!u && u > now(); }
const smallModel = (env) => env.AI_MODEL_SMALL || '@cf/meta/llama-3.1-8b-instruct-fast';

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
const pagesPerRun = (env) => (isPaid(env) ? 40 : 6); // 6 pages stays under 50 fetches on Free; 40 on Paid
export async function discover(env, opts = {}) {
  return withRun(env.DB, 'discover', async () => {
    const tags = (await getSetting(env.DB, 'steam_tags', [])).filter((t) => t.id);
    const extra = await getSetting(env.DB, 'extra_appids', []);
    const cursor = await getSetting(env.DB, 'discover_cursor', { tag: 0, page: 0 });
    if (opts.reset) { cursor.tag = 0; cursor.page = 0; }
    const PAGES_PER_RUN = pagesPerRun(env);
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
      if (pagesThisRun < PAGES_PER_RUN) await steam.pause(isPaid(env) ? 120 : 250);
    }
    if (ti >= tags.length) { done = true; ti = 0; pg = 0; }
    await setSetting(env.DB, 'discover_cursor', { tag: ti, page: pg });
    // Extra appids only need doing once, when we've finished a full sweep.
    if (done) for (const appid of extra) if (await upsertGameFromSteamSearch(env.DB, { appid: Number(appid), name: `app ${appid}`, source: 'manual' })) added++;
    if (tags.length && seen === 0 && !done) throw new Error('Steam search returned no items; the search HTML may have changed');
    await syncBudgetDaily(env); // free correctness check: confirms the local PlatPrices tracker against their real numbers once a day
    return { count: added, note: done ? `swept all tags, seen ${seen} this pass` : `seen ${seen}, more pages queued (tag ${ti}, page ${pg})` };
  });
}

// Once-a-day reconciliation against PlatPrices' own /status, so a wrong or missing rate-limit header can never
// silently wedge match/refresh again. Only calls out if it hasn't already run today; failures are swallowed.
export async function syncBudgetDaily(env) {
  if (!env.PLATPRICES_KEY) return;
  const last = await getSetting(env.DB, 'budget_synced_on', null);
  const today = now().slice(0, 10);
  if (last === today) return;
  try { await syncBudgetFromStatus(env.DB, await pp.status(env)); await setSetting(env.DB, 'budget_synced_on', today); } catch { /* try again next tick */ }
}

// 2. Enrich: appdetails + reviews + tag votes for new games, and games not enriched in 7 days.
// 3 Steam fetches per game, so the batch is capped hard at 12 to stay under the 50-subrequest invocation limit.
const enrichMax = (env) => (isPaid(env) ? 120 : 9); // 5 fetches per game: 45 on Free, 600 on Paid
export async function enrich(env, opts = {}) {
  return withRun(env.DB, 'enrich', async () => {
    const limit = Math.min(enrichMax(env), limitOf(env, opts.limit));
    const { results } = await env.DB.prepare(
      `SELECT g.appid FROM games g LEFT JOIN steam_cache c ON c.appid = g.appid
       WHERE (g.status = 'new' OR (g.status = 'error' AND COALESCE(g.error_count,0) < ${MAX_ERRORS} AND (g.last_enriched IS NULL OR g.last_enriched < ?))
              OR (g.status = 'enriched' AND (g.last_enriched IS NULL OR g.last_enriched < ? OR c.news_json IS NULL)${scopeSql(scopeOf(opts))}))
       ORDER BY CASE g.status WHEN 'new' THEN 0 WHEN 'error' THEN 1 ELSE 2 END, (c.news_json IS NULL) DESC, g.last_enriched LIMIT ?`
    ).bind(daysFromNow(-1 / 24), daysFromNow(-7), limit).all();
    let n = 0;
    const over = budgetClock(env);
    for (const { appid } of results) {
      if (over()) break;
      try {
        const d = await steam.appDetails(appid);
        if (!d) { await env.DB.prepare(`UPDATE games SET status = 'excluded', last_error = 'appdetails empty', last_enriched = ? WHERE appid = ?`).bind(now(), appid).run(); continue; }
        if (d.type !== 'game') { await env.DB.prepare(`UPDATE games SET status = 'excluded', last_error = ?, last_enriched = ? WHERE appid = ?`).bind(`type ${d.type}`, now(), appid).run(); continue; }
        const r = await steam.appReviews(appid).catch(() => null);
        const tv = await steam.tagVotes(appid);
        const news = await steam.appNews(appid);
        const players = await steam.currentPlayers(appid);
        const hoursList = (r?.reviews || []).map((x) => (x.author?.playtime_forever || 0) / 60).filter((h) => h > 0).sort((a, b) => a - b);
        const hoursMedian = hoursList.length ? Math.round(hoursList[Math.floor(hoursList.length / 2)]) : null;
        const qs = (r && r.query_summary) || {};
        const genres = (d.genres || []).map((g) => g.description);
        const ea = genres.includes('Early Access') ? 1 : 0;
        const tagVotes = tv ? (tv.find((t) => /bullet heaven/i.test(t.name))?.count ?? 0) : null;
        await env.DB.prepare(
          `UPDATE games SET name = ?, steam_release = ?, coming_soon = ?, developer = ?, publisher = ?, header_img = ?, early_access = ?,
             status = 'enriched', tag_votes = ?, steam_pos = ?, steam_neg = ?, steam_score_desc = ?, last_enriched = ?, last_error = NULL, error_count = 0,
             review_hours_median = ?, players_now = COALESCE(?, players_now), players_at = CASE WHEN ? IS NULL THEN players_at ELSE ? END WHERE appid = ?`
        ).bind(
          d.name || `app ${appid}`, d.release_date?.date || null, d.release_date?.coming_soon ? 1 : 0,
          (d.developers || []).join(', ') || null, (d.publishers || []).join(', ') || null, d.header_image || null, ea,
          tagVotes, qs.total_positive ?? null, qs.total_negative ?? null, qs.review_score_desc || null, now(),
          hoursMedian, players, players, now(), appid
        ).run();
        const slim = {
          name: d.name, short_description: d.short_description, about: steam.stripHtml(d.about_the_game || d.detailed_description),
          release_date: d.release_date, genres, categories: (d.categories || []).map((c) => c.description), metacritic: d.metacritic || null,
          recommendations: d.recommendations || null, platforms: d.platforms || null, is_free: d.is_free || false
        };
        const reviews = r ? { query_summary: qs, reviews: (r.reviews || []).map((x) => ({ voted_up: x.voted_up, votes_up: x.votes_up, hours: Math.round((x.author?.playtime_forever || 0) / 60), text: x.review })) } : null;
        await env.DB.prepare(
          `INSERT INTO steam_cache (appid, appdetails_json, appreviews_json, tag_votes_json, news_json, fetched_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(appid) DO UPDATE SET appdetails_json = excluded.appdetails_json, appreviews_json = excluded.appreviews_json, tag_votes_json = excluded.tag_votes_json, news_json = COALESCE(excluded.news_json, steam_cache.news_json), fetched_at = excluded.fetched_at`
        ).bind(appid, JSON.stringify(slim), reviews ? JSON.stringify(reviews) : null, tv ? JSON.stringify(tv) : null, news ? JSON.stringify(news) : JSON.stringify([]), now()).run();
        // News changed since the last plan read: let the plans stage look again.
        // Free news reads refresh after 30 days; paid web reads hold for 90. Dated announcements are never re-read.
        await env.DB.prepare(`UPDATE games SET ps5_plan_at = NULL WHERE appid = ? AND ps5_plan IS NOT NULL AND ps5_plan NOT IN ('announced_date')
          AND ((ps5_plan_method = 'web' AND ps5_plan_at < ?) OR (COALESCE(ps5_plan_method,'news') != 'web' AND ps5_plan_at < ?))`).bind(appid, daysFromNow(-90), daysFromNow(-30)).run();
        n++;
        await steam.pause(isPaid(env) ? 120 : 300);
      } catch (e) {
        await env.DB.prepare(`UPDATE games SET status = 'error', last_error = ?, last_enriched = ?, error_count = COALESCE(error_count,0) + 1 WHERE appid = ?`).bind(String(e.message || e).slice(0, 300), now(), appid).run();
        if (/rate-limited/.test(String(e.message))) { await steam.pause(5000); }
      }
    }
    return { count: n };
  });
}

// Name variants for the PlatPrices search, most specific first. Console listings drop subtitles and add edition words.
export function nameVariants(name) {
  const clean = (x) => x.replace(/[™®©]/g, '').replace(/\s+/g, ' ').trim();
  const full = clean(name);
  const out = [full];
  const head = clean(full.split(/\s*[:\u2013\u2014-]\s+/)[0]);
  if (head && head.length >= 4 && head.toLowerCase() !== full.toLowerCase()) out.push(head);
  const stripped = clean(full.replace(/\b(complete|definitive|ultimate|deluxe|goty|game of the year|anniversary|remastered|enhanced|console|special|gold|premium|standard)\b\s*(edition)?/gi, '').replace(/\s*[:\u2013\u2014-]\s*$/, ''));
  if (stripped && stripped.length >= 4 && !out.some((o) => o.toLowerCase() === stripped.toLowerCase())) out.push(stripped);
  return out.slice(0, 3);
}


// Deterministic fallback matcher. A normalised exact title match is more reliable than a small model's judgement,
// so it is tried first; the model only has to adjudicate the ambiguous cases.
export function normaliseTitle(x) {
  return String(x || '')
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/\b(complete|definitive|ultimate|deluxe|goty|game of the year|anniversary|remastered|enhanced|console|special|gold|premium|standard)\b/g, '')
    .replace(/\bedition\b/g, '')
    .replace(/\b(ps4|ps5|playstation ?[45]?)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// How confidently do two normalised titles refer to the same game? 1 = exact.
// Console listings routinely drop a subtitle ("Nordic Ashes: Survivors of Ragnarok" ships as "Nordic Ashes"),
// so a whole-word prefix counts strongly; otherwise fall back to token overlap, which keeps
// "Vampire Survivors" from matching "Zombie Survivors".
export function titleSimilarity(a, b) {
  const x = normaliseTitle(a), y = normaliseTitle(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const short = x.length <= y.length ? x : y;
  const long = x.length <= y.length ? y : x;
  // whole-word prefix: the shorter title is how the longer one begins
  if (long === short || long.startsWith(short + ' ')) {
    const words = short.split(' ').filter(Boolean).length;
    if (words >= 2 || short.length >= 10) return 0.92;
    return 0.6; // a single short word ("Halls") is too weak to trust on its own
  }
  const ax = new Set(x.split(' ').filter(Boolean));
  const by = new Set(y.split(' ').filter(Boolean));
  const inter = [...ax].filter((t) => by.has(t)).length;
  const union = new Set([...ax, ...by]).size;
  return union ? inter / union : 0;
}

// Best candidate by title alone, preferring a full game over bundles and the cheapest edition.
// Returns null unless the best is confident enough to accept without a model.
export function pickByTitle(name, cands, minScore = 0.9) {
  let best = null, bestScore = 0;
  for (const c of cands) {
    const sc = titleSimilarity(name, c.ProductName);
    const isFull = String(c.StoreClass || '').toUpperCase() === 'FULL_GAME';
    // tie-break toward full games and cheaper editions
    const adjusted = sc + (isFull ? 0.001 : 0) - (Number(c.BasePrice) || 0) / 1e12;
    if (sc >= minScore && adjusted > bestScore) { best = c; bestScore = adjusted; }
  }
  return best;
}

// One game, live, showing every step of the match decision. Backs the Queue diagnostic.
export async function matchDebug(env, appid) {
  const g = await env.DB.prepare(`SELECT appid, name, developer, publisher, steam_release, psn_status, ppid, next_match_at, last_error FROM games WHERE appid = ?`).bind(appid).first();
  if (!g) return { error: 'no such game' };
  const out = { appid: g.appid, name: g.name, psn_status: g.psn_status, ppid: g.ppid, next_match_at: g.next_match_at, last_error: g.last_error, variants: nameVariants(g.name), searches: [] };
  let cands = [];
  for (const q of nameVariants(g.name)) {
    if (cands.length) break;
    try {
      const r = (await pp.searchGames(env, q)).filter((c) => Number(c.IsDLC) !== 1 && Number(c.IsDemoOrSoundtrack) !== 1);
      out.searches.push({ query: q, returned: r.length });
      cands = r;
    } catch (e) { out.searches.push({ query: q, error: String(e.message || e) }); }
  }
  out.candidates = cands.slice(0, 10).map((c) => ({ PPID: c.PPID, ProductName: c.ProductName, StoreClass: c.StoreClass, BasePrice: c.BasePrice, normalised: normaliseTitle(c.ProductName) }));
  out.normalised_query = normaliseTitle(g.name);
  const byTitle = pickByTitle(g.name, cands);
  out.exact_title_match = byTitle ? { PPID: byTitle.PPID, ProductName: byTitle.ProductName } : null;
  if (cands.length) {
    try {
      const ai = await runJSON(env, { system: MATCH_SYSTEM, user: matchUser({ name: g.name, developer: g.developer, publisher: g.publisher, release: g.steam_release }, cands), maxTokens: 200, model: smallModel(env) });
      out.model = ai.model;
      out.model_raw = String(ai.text || '').slice(0, 800);
      out.model_parsed = ai.json;
    } catch (e) { out.model_error = String(e.message || e); }
  }
  return out;
}


// Add a game by Steam appid or store URL, bypassing tag discovery. Tag-based discovery misses games whose
// Bullet Heaven tag has not caught on yet (Entropy Survivors, for one), so there has to be a manual door.
export function parseAppid(input) {
  const str = String(input || '').trim();
  const m = str.match(/store\.steampowered\.com\/app\/(\d+)/i) || str.match(/^(\d{3,9})$/);
  return m ? Number(m[1]) : null;
}

export async function addGame(env, input) {
  const appid = parseAppid(input);
  if (!appid) return { ok: false, error: 'Give a Steam appid or a store.steampowered.com/app/... URL' };
  const existing = await env.DB.prepare('SELECT appid, name, status FROM games WHERE appid = ?').bind(appid).first();
  if (existing) return { ok: true, appid, name: existing.name, already: true, note: `Already tracked (${existing.status})` };
  let name = `app ${appid}`;
  try { const d = await steam.appDetails(appid); if (d && d.name) name = d.name; if (d && d.type && d.type !== 'game') return { ok: false, error: `Steam says that appid is a ${d.type}, not a game` }; }
  catch (e) { return { ok: false, error: `Could not read that appid from Steam: ${String(e.message || e).slice(0, 140)}` }; }
  await env.DB.prepare(`INSERT INTO games (appid, name, source, first_seen) VALUES (?, ?, 'manual', ?) ON CONFLICT(appid) DO NOTHING`).bind(appid, name, now()).run();
  return { ok: true, appid, name, already: false, note: 'Added. The Runner will enrich, score, and match it.' };
}

// 3. Match: find the PSN listing for enriched, unmatched games. Gated by score so PlatPrices' limited monthly
// quota goes to games actually worth buying: below match_min_score, a game waits until it is tagged and clears
// the bar, or until Kevin marks it "want" (which always bypasses the gate). Score 0 in Settings disables the gate.
export async function match(env, opts = {}) {
  return withRun(env.DB, 'match', async () => {
    const limit = limitOf(env, opts.limit);
    const threshold = await worthThreshold(env);
    const gate = threshold > 0 ? ` AND (COALESCE(k.want,0) = 1 OR (f.score IS NOT NULL AND f.score >= ${threshold}))` : '';
    const { results } = await env.DB.prepare(
      `SELECT g.appid, g.name, g.developer, g.publisher, g.steam_release FROM games g
       LEFT JOIN facets f ON f.appid = g.appid LEFT JOIN kevin k ON k.appid = g.appid
       WHERE g.status = 'enriched' AND g.psn_status IN ('unmatched','not_listed') AND g.ppid IS NULL
         AND (g.next_match_at IS NULL OR g.next_match_at <= ?)${gate}${scopeSql(scopeOf(opts), 'g')}
       ORDER BY g.psn_status = 'unmatched' DESC, g.first_seen LIMIT ?`
    ).bind(now(), limit).all();
    let n = 0, skipped = 0, failed = 0, firstError = null;
    const over = budgetClock(env);
    for (const g of results) {
      if (over()) break;
      // Systemic failure guard: if the first few all fail the same way (bad key, wrong region, API down),
      // stop the batch instead of burning through the queue marking every game with the same error.
      if (failed >= 3 && n === 0) break;
      if (!(await canSpend(env.DB, 1))) { skipped++; continue; }
      try {
        let cands = [];
        for (const q of nameVariants(g.name)) {
          if (cands.length) break;
          if (!(await canSpend(env.DB, 1))) break;
          cands = (await pp.searchGames(env, q)).filter((c) => Number(c.IsDLC) !== 1 && Number(c.IsDemoOrSoundtrack) !== 1);
        }
        if (!cands.length) {
          await env.DB.prepare(`UPDATE games SET psn_status = 'not_listed', next_match_at = ? WHERE appid = ?`).bind(daysFromNow(7), g.appid).run();
          n++; continue;
        }
        // Exact normalised title match wins outright -- no model judgement needed, and it cannot be lost to bad JSON.
        const exact = pickByTitle(g.name, cands);
        let ai = { json: null, text: '' };
        if (!exact) {
          ai = await runJSON(env, { system: MATCH_SYSTEM, user: matchUser({ name: g.name, developer: g.developer, publisher: g.publisher, release: g.steam_release }, cands), maxTokens: 200, model: smallModel(env) });
        }
        const pick = exact ? { ppid: exact.PPID, confidence: 1, reason: 'exact title match' } : (ai.json || {});
        const chosen = cands.find((c) => Number(c.PPID) === Number(pick.ppid));
        const conf = Number(pick.confidence) || 0;
        // A model that returned nothing parseable is not evidence the game is absent from the store.
        const modelFailed = !exact && !ai.json;
        await env.DB.prepare(`INSERT INTO match_candidates (appid, candidates_json, ai_json, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(appid) DO UPDATE SET candidates_json = excluded.candidates_json, ai_json = excluded.ai_json, created_at = excluded.created_at`)
          .bind(g.appid, JSON.stringify(cands.slice(0, 40)), JSON.stringify(pick), now()).run();
        const mode = await getSetting(env.DB, 'review_mode', 'auto');
        const acceptAt = mode === 'auto' ? 0.7 : 0.9;
        if (chosen && conf >= acceptAt) {
          await acceptMatch(env, g.appid, chosen);
        } else if (chosen && conf >= 0.5 && mode !== 'auto') {
          await env.DB.prepare(`UPDATE games SET psn_status = 'review', next_match_at = NULL WHERE appid = ?`).bind(g.appid).run();
        } else if (modelFailed && pickByTitle(g.name, cands, 0.6)) {
          // Model unusable, but the titles line up well enough to accept rather than lose a real listing.
          await acceptMatch(env, g.appid, pickByTitle(g.name, cands, 0.6));
        } else if (modelFailed) {
          // Retry sooner and say why, rather than declaring the game absent on the strength of a parse failure.
          failed++;
          if (!firstError) firstError = `model returned no usable JSON for "${g.name}"`;
          await env.DB.prepare(`UPDATE games SET last_error = ?, next_match_at = ? WHERE appid = ?`)
            .bind(`match: model returned no usable JSON (${cands.length} candidates were available)`, daysFromNow(0.25), g.appid).run();
        } else {
          await env.DB.prepare(`UPDATE games SET psn_status = 'not_listed', next_match_at = ? WHERE appid = ?`).bind(daysFromNow(7), g.appid).run();
        }
        n++;
      } catch (e) {
        failed++;
        const msg = String(e.message || e);
        if (!firstError) firstError = msg;
        // Only defer a game if the batch is otherwise healthy. On a systemic failure, leave next_match_at alone
        // so the whole queue is retried immediately once the underlying problem is fixed.
        const systemic = failed >= 3 && n === 0;
        await env.DB.prepare(
          systemic
            ? `UPDATE games SET last_error = ? WHERE appid = ?`
            : `UPDATE games SET last_error = ?, next_match_at = ? WHERE appid = ?`
        ).bind(...(systemic ? [msg.slice(0, 300), g.appid] : [msg.slice(0, 300), daysFromNow(1), g.appid])).run();
      }
    }
    const bits = [];
    if (failed) bits.push(`${failed} failed: ${String(firstError).slice(0, 160)}`);
    if (skipped) bits.push(`${skipped} skipped, budget reserve`);
    return { count: n, note: bits.join('; ') || null };
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

// 4b. Deals: one list request returns a page of everything discounted in the region, instead of one request per
// game. Used to spot sales on tracked games cheaply, and to notice that an unmatched game exists on the store.
export async function deals(env, opts = {}) {
  return withRun(env.DB, 'deals', async () => {
    const maxPages = Math.max(1, Math.min(20, Number(opts.pages) || (isPaid(env) ? 8 : 4)));
    if (!(await canSpend(env.DB, maxPages))) return { count: 0, note: `needs ${maxPages} requests, budget reserve reached` };
    const known = new Map((await env.DB.prepare(`SELECT ppid, appid FROM psn_products WHERE ppid IS NOT NULL`).all()).results.map((r) => [Number(r.ppid), r.appid]));
    let updated = 0, changed = 0, seen = 0, unknown = 0;
    const t = now();
    for (let page = 1; page <= maxPages; page++) {
      const { rows, hasMore } = await pp.recentDeals(env, page);
      seen += rows.length;
      for (const g of rows) {
        const ppid = Number(g.PPID);
        if (!ppid) continue;
        const appid = known.get(ppid);
        if (appid) {
          if (await pp.upsertProduct(env.DB, pp.toProductRow(g, appid), t)) changed++;
          updated++;
        } else unknown++;
      }
      if (!rows.length || !hasMore) break;
    }
    return { count: updated, note: `${seen} discounted products seen, ${changed} price changes on tracked games, ${unknown} not in the catalogue` };
  });
}

// 5. Tag: first-pass facets for enriched games with no facets, or whose review count has doubled since tagging.
export async function tag(env, opts = {}) {
  return withRun(env.DB, 'tag', async () => {
    if (await aiCapped(env)) return { count: 0, note: 'daily AI allocation used, waiting for 00:00 UTC' };
    const limit = limitOf(env, opts.limit);
    const settings = { ...DEFAULT_SETTINGS, ...(await getSetting(env.DB, 'taste', {})) };
    const { results } = await env.DB.prepare(
      `SELECT g.appid, g.name, g.developer, g.publisher, g.steam_release, g.early_access, g.steam_pos, g.steam_neg, g.steam_score_desc, g.last_update_seen,
              c.appdetails_json, c.appreviews_json, c.tag_votes_json,
              p.desc AS psn_desc, p.star_rating, p.star_count,
              f.appid AS has_facets, f.reviews_at_tag, f.confirmed_by
       FROM games g LEFT JOIN steam_cache c ON c.appid = g.appid LEFT JOIN psn_products p ON p.ppid = g.ppid LEFT JOIN facets f ON f.appid = g.appid
       WHERE g.status = 'enriched' AND c.appdetails_json IS NOT NULL
         AND (f.appid IS NULL OR (f.confirmed_by IS NULL AND COALESCE(g.steam_pos,0)+COALESCE(g.steam_neg,0) >= 2 * COALESCE(f.reviews_at_tag, 0) + 20))${scopeSql(scopeOf(opts))}
       ORDER BY g.psn_status = 'matched' DESC, COALESCE(g.steam_pos,0) DESC LIMIT ?`
    ).bind(limit).all();
    let n = 0;
    const over = budgetClock(env);
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
        const ai = await runJSON(env, { system: TAG_SYSTEM, user: tagUser(corpus), maxTokens: 1600, job: 'tag' });
        if (!ai.json || !ai.json.facets) throw new Error('model returned no facets JSON');
        const facets = normalizeFacets(ai.json.facets);
        const evidence = normalizeEvidence(ai.json.evidence);
        const reviewsTotal = (g.steam_pos || 0) + (g.steam_neg || 0);
        const q = computeQuality({ steamPos: g.steam_pos, steamNeg: g.steam_neg, psnRating: g.star_rating, psnCount: g.star_count, abandonedEA: false });
        facets.quality = q.quality;
        const { score } = scoreGame(facets, settings);
        const kevin = (await env.DB.prepare('SELECT owned, never FROM kevin WHERE appid = ?').bind(g.appid).first()) || {};
        const category = categorize(facets, score, q.reviews, kevin, settings);
        const mode = await getSetting(env.DB, 'review_mode', 'auto');
        const review = mode !== 'auto' && needsReview(facets, score, settings) ? 1 : 0;
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
        const msg = String(e.message || e);
        if (!/^claude /.test(msg) && isCapError(e)) { await markAiCapped(env); return { count: n, note: 'daily AI allocation reached, resumes after 00:00 UTC' }; }
        await env.DB.prepare(`UPDATE games SET last_error = ? WHERE appid = ?`).bind(`tag: ${msg.slice(0, 280)}`, g.appid).run();
        if (/^claude (401|402|403|429)/.test(msg)) return { count: n, note: `stopped: ${msg.slice(0, 120)}` };
      }
    }
    return { count: n };
  });
}

// 6. Plans: what has the developer said about a PlayStation release. Steam-only games only; matched games have a real date.
// Two methods: 'news' reads the Steam news feed with the small Workers AI model (free); 'web' has Claude search the web
// (PLANS_WEB_SEARCH=1 and ANTHROPIC_API_KEY set), which is what actually finds announcements that never hit Steam news.
export const PLAN_STATUSES = ['announced_date', 'announced_window', 'announced', 'planned', 'not_planned', 'unknown', 'listed'];
export const planMethod = (env) => (env.ANTHROPIC_API_KEY && String(env.PLANS_WEB_SEARCH || '') === '1' ? 'web' : 'news');
// Web search costs real money per game, so it is reserved for games worth a port: scored at least the shared
// worthThreshold (default 70) with at least PLANS_WEB_MIN_REVIEWS (50) Steam reviews. Everything else uses the free news method.
// The one live, no-redeploy-needed "is this worth spending on" threshold. Lives in the taste settings blob
// (Settings page), not an env var, so Kevin can flip it from 70 to 60 to 0 without pushing code.
export async function worthThreshold(env) {
  const s = await getSetting(env.DB, 'taste', {});
  const t = Number(s.match_min_score);
  return Number.isFinite(t) ? t : 55;
}
const webMinReviews = (env) => Number(env.PLANS_WEB_MIN_REVIEWS) || 50;
const webWorthSql = (threshold, env) => ` AND COALESCE(f.score, -1) >= ${threshold} AND COALESCE(g.steam_pos,0)+COALESCE(g.steam_neg,0) >= ${webMinReviews(env)}`;

// Normalise whatever the model returned. Accepts status/ps5_status, any case, stray spaces.
export function parsePlan(j) {
  const raw = String((j && (j.ps5_status ?? j.status ?? j.playstation_status)) || 'unknown').toLowerCase().trim().replace(/[\s-]+/g, '_');
  const status = PLAN_STATUSES.includes(raw) ? raw : (/date/.test(raw) ? 'announced_date' : /window/.test(raw) ? 'announced_window' : /not/.test(raw) ? 'not_planned' : /announce|confirm/.test(raw) ? 'announced' : /plan/.test(raw) ? 'planned' : /list|available|out now|released/.test(raw) ? 'listed' : 'unknown');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String((j && (j.ps5_date ?? j.date)) || '')) ? (j.ps5_date ?? j.date) : null;
  const window = typeof (j && (j.ps5_window ?? j.window)) === 'string' ? String(j.ps5_window ?? j.window).slice(0, 40) : null;
  const note = typeof (j && j.evidence) === 'string' ? j.evidence.slice(0, 300) : null;
  const platform = ['ps5', 'ps4', 'both'].includes(String((j && j.platform) || '').toLowerCase()) && /^(announced|listed)/.test(status) ? String(j.platform).toLowerCase() : 'unspecified';
  const url = typeof (j && j.source_url) === 'string' && /^https?:\/\//.test(j.source_url) ? j.source_url.slice(0, 300) : null;
  const conf = Number(j && j.confidence);
  return { status, date: status === 'announced_date' || status === 'listed' ? date : null, window: status === 'announced_window' ? window : null, note: status === 'unknown' ? null : note, platform, url, confidence: Number.isFinite(conf) ? conf : null };
}

async function readPlanFor(env, g, forceMethod = null) {
  const method = forceMethod || planMethod(env);
  if (method === 'web') {
    const ai = await runClaude(env, { system: PLAN_WEB_SYSTEM, user: planWebUser(g), maxTokens: 700, webSearch: true, maxSearches: 2 });
    return { ai, method };
  }
  const d = JSON.parse(g.appdetails_json || '{}');
  const news = JSON.parse(g.news_json || '[]');
  const ai = await runJSON(env, { system: PLAN_SYSTEM, user: planUser({ name: g.name, short_description: d.short_description, description: d.about, news }), maxTokens: 300, model: smallModel(env) });
  return { ai, method, newsCount: news.length };
}

export async function plans(env, opts = {}) {
  return withRun(env.DB, 'plans', async () => {
    // Pass 1 (free): anything unread gets the news method. Pass 2 (paid, gated): games worth a port that the news method
    // could not answer get one web read, if PLANS_WEB_SEARCH=1 and the monthly Claude cap has room.
    if (await aiCapped(env)) return { count: 0, note: 'daily AI allocation used, waiting for 00:00 UTC' };
    const limit = limitOf(env, opts.limit);
    const sc = scopeSql(scopeOf(opts));
    let n = 0, found = 0, web = 0, usd = 0;
    const over = budgetClock(env);
    const unread = (await env.DB.prepare(
      `SELECT g.appid, g.name, g.developer, g.publisher, g.steam_release, c.appdetails_json, c.news_json FROM games g JOIN steam_cache c ON c.appid = g.appid
       WHERE g.status = 'enriched' AND g.ppid IS NULL AND c.news_json IS NOT NULL AND g.ps5_plan_at IS NULL${sc}
       ORDER BY COALESCE(g.steam_pos,0) DESC LIMIT ?`).bind(limit).all()).results;
    for (const g of unread) {
      if (over()) break;
      try {
        const { ai } = await readPlanFor(env, g, 'news');
        const pl = parsePlan(ai.json || {});
        if (pl.status !== 'unknown') found++;
        await env.DB.prepare(`UPDATE games SET ps5_plan = ?, ps5_plan_date = ?, ps5_plan_window = ?, ps5_plan_note = ?, ps5_plan_platform = ?, ps5_plan_url = NULL, ps5_plan_method = 'news', ps5_plan_at = ? WHERE appid = ?`)
          .bind(pl.status, pl.date, pl.window, pl.note, pl.platform, now(), g.appid).run();
        n++;
      } catch (e) {
        if (isCapError(e)) { await markAiCapped(env); return { count: n, note: 'daily AI allocation reached, resumes after 00:00 UTC' }; }
        await env.DB.prepare(`UPDATE games SET last_error = ?, ps5_plan = 'unknown', ps5_plan_method = 'news', ps5_plan_at = ? WHERE appid = ?`).bind(`plans: ${String(e.message || e).slice(0, 280)}`, now(), g.appid).run();
      }
    }
    if (planMethod(env) === 'web' && !over()) {
      const threshold = await worthThreshold(env);
      const webLimit = Math.min(15, limit);
      const worth = threshold > 0 ? (await env.DB.prepare(
        `SELECT g.appid, g.name, g.developer, g.publisher, g.steam_release FROM games g LEFT JOIN facets f ON f.appid = g.appid
         WHERE g.status = 'enriched' AND g.ppid IS NULL AND g.ps5_plan_method = 'news' AND g.ps5_plan IN ('unknown','planned')${webWorthSql(threshold, env)}${sc}
         ORDER BY f.score DESC LIMIT ?`).bind(webLimit).all()).results : [];
      for (const g of worth) {
        if (over()) break;
        try {
          const { ai } = await readPlanFor(env, g, 'web');
          const pl = parsePlan(ai.json || {});
          usd += ai.usd || 0; web++;
          if (pl.status !== 'unknown') found++;
          await env.DB.prepare(`UPDATE games SET ps5_plan = ?, ps5_plan_date = ?, ps5_plan_window = ?, ps5_plan_note = ?, ps5_plan_platform = ?, ps5_plan_url = ?, ps5_plan_method = 'web', ps5_plan_at = ? WHERE appid = ?`)
            .bind(pl.status, pl.date, pl.window, pl.note, pl.platform, pl.url, now(), g.appid).run();
          if (pl.status === 'listed') await env.DB.prepare(`UPDATE games SET psn_status = 'not_listed', next_match_at = NULL WHERE appid = ? AND ppid IS NULL`).bind(g.appid).run();
          n++;
        } catch (e) {
          const msg = String(e.message || e);
          if (/^claude (401|402|403|429)/.test(msg)) return { count: n, note: `stopped: ${msg.slice(0, 140)}` };
          await env.DB.prepare(`UPDATE games SET last_error = ?, ps5_plan_method = 'web', ps5_plan_at = ? WHERE appid = ?`).bind(`plans: ${msg.slice(0, 280)}`, now(), g.appid).run();
        }
      }
    }
    return { count: n, note: `${found} with something announced; ${web} web reads ($${usd.toFixed(2)})` };
  });
}

// Re-queue plans reads: everything not yet read with the current method, or (all: true) every non-dated one.
export async function replan(env, opts = {}) {
  return withRun(env.DB, 'replan', async () => {
    // Re-queues the FREE news read for games never read by it. Web reads are chosen automatically inside plans()
    // (score >= 60, 50+ reviews, news said unknown), so nothing here spends money.
    const r = await env.DB.prepare(`UPDATE games SET ps5_plan_at = NULL WHERE ppid IS NULL AND ps5_plan_at IS NOT NULL AND ps5_plan != 'announced_date' AND ps5_plan_method IS NULL`).run();
    const threshold = await worthThreshold(env);
    const worth = threshold > 0 ? await env.DB.prepare(`SELECT COUNT(*) AS n FROM games g LEFT JOIN facets f ON f.appid = g.appid WHERE g.status = 'enriched' AND g.ppid IS NULL AND (g.ps5_plan_method IS NULL OR g.ps5_plan_method = 'news') AND COALESCE(g.ps5_plan,'unknown') IN ('unknown','planned')${webWorthSql(threshold, env)}`).first() : { n: 0 };
    return { count: r.meta.changes, note: `${r.meta.changes} queued for the free news read; ${worth.n} would qualify for a web read at the current minimum score (${threshold || 'off'})` };
  });
}

// One game, live, with everything the reader saw. For the diagnostics panel.
export async function planDebug(env, appid) {
  const g = await env.DB.prepare(`SELECT g.appid, g.name, g.developer, g.publisher, g.steam_release, c.appdetails_json, c.news_json FROM games g LEFT JOIN steam_cache c ON c.appid = g.appid WHERE g.appid = ?`).bind(appid).first();
  if (!g) return { error: 'no such game' };
  const news = g.news_json ? JSON.parse(g.news_json) : null;
  const consoleMentions = (news || []).filter((x) => /playstation|ps5|ps4|console|sony/i.test(`${x.title} ${x.text}`)).map((x) => ({ date: x.date, title: x.title }));
  const { ai, method } = await readPlanFor(env, g);
  return { appid: g.appid, name: g.name, method, news_count: news ? news.length : null, console_mentions: consoleMentions, model: ai.model, searches: ai.searches ?? null, raw_text: String(ai.text || '').slice(0, 3000), parsed: parsePlan(ai.json || {}) };
}

// Queue unconfirmed games tagged by a DIFFERENT model for a fresh pass with the current one.
// Already-current and hand-confirmed facets are never touched. Old facets stay visible until replaced.
export const currentTagger = (env) => (env.ANTHROPIC_API_KEY ? (env.CLAUDE_MODEL || 'claude-haiku-4-5') : (env.AI_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast'));
export async function retag(env) {
  return withRun(env.DB, 'retag', async () => {
    const cur = currentTagger(env);
    const r = await env.DB.prepare(`UPDATE facets SET reviews_at_tag = -100000, needs_review = 0 WHERE confirmed_by IS NULL AND (model IS NULL OR model != ?) AND reviews_at_tag >= 0`).bind(cur).run();
    const same = await env.DB.prepare(`SELECT COUNT(*) AS n FROM facets WHERE model = ?`).bind(cur).first();
    return { count: r.meta.changes, note: `queued for re-score with ${cur}; ${same.n} already on it, confirmed facets untouched` };
  });
}

// Re-queue "not listed" games for another match pass. Matched games are never touched; a re-match can only add a listing.
// By default only titles the smarter search can help with (a subtitle or an edition word); `all: true` does every not-listed game.
export async function rematch(env, opts = {}) {
  return withRun(env.DB, 'rematch', async () => {
    const { results } = await env.DB.prepare(`SELECT appid, name FROM games WHERE psn_status IN ('not_listed','unmatched') AND ppid IS NULL`).all();
    const targets = results.filter((g) => opts.all || nameVariants(g.name).length > 1);
    for (const g of targets) await env.DB.prepare(`UPDATE games SET next_match_at = NULL WHERE appid = ? AND ppid IS NULL`).bind(g.appid).run();
    await setSetting(env.DB, 'rematch_done_v1', true);
    return { count: targets.length, note: `${targets.length} of ${results.length} not-listed games queued (${opts.all ? 'all' : 'those with a subtitle or edition word'}); matched games untouched` };
  });
}

// Reset errored games so they get retried now, and clear stale error text on healthy rows.
export async function retryErrors(env) {
  return withRun(env.DB, 'retry-errors', async () => {
    const a = await env.DB.prepare(`UPDATE games SET status = 'new', error_count = 0, last_error = NULL, last_enriched = NULL WHERE status = 'error'`).run();
    const b = await env.DB.prepare(`UPDATE games SET last_error = NULL WHERE status = 'enriched' AND last_error IS NOT NULL`).run();
    // A failed match defers the game a day. Clearing only the error text left it parked and invisible to the
    // queue, so the button did not actually retry anything -- clear the deferral too.
    const c = await env.DB.prepare(`UPDATE games SET next_match_at = NULL WHERE ppid IS NULL AND next_match_at IS NOT NULL AND next_match_at > ?`).bind(now()).run();
    await env.DB.prepare(`UPDATE games SET ps5_plan_at = NULL WHERE ps5_plan = 'unknown' AND ps5_plan_note IS NULL`).run();
    await setSetting(env.DB, 'ai_capped_until', null);
    return { count: a.meta.changes, note: `${b.meta.changes} error notes cleared, ${c.meta.changes} un-deferred for matching, AI stages unparked` };
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

export const STAGES = { discover, enrich, match, refresh, deals, tag, plans, rescore, retag, rematch, replan, 'retry-errors': retryErrors };
