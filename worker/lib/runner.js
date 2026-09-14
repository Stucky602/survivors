// The Runner: a Durable Object that drains the pipeline one batch per alarm.
// Each alarm is its own Worker invocation with its own 50-subrequest budget, which is the only way
// to backfill several hundred games on the free plan without a human clicking a button per batch.
import { STAGES, aiCapped, isPaid, scopeSql, SCOPES, planMethod, worthThreshold, syncBudgetDaily } from './stages.js';
import { claudeOverBudget } from './ai.js';
import { getSetting, daysFromNow, now } from './db.js';

const tickMs = (env) => (isPaid(env) ? 8000 : 45000); // between batches
const MAX_TICKS = 400;      // safety: stops on its own after ~5 hours of continuous work
const IDLE_NOTE = 'idle';

export class Runner {
  constructor(state, env) { this.state = state; this.env = env; }

  async fetch(request) {
    const url = new URL(request.url);
    const cmd = url.pathname.split('/').pop();
    if (cmd === 'start') {
      const scope = SCOPES.includes(url.searchParams.get('scope')) ? url.searchParams.get('scope') : 'all';
      await this.state.storage.put('scope', scope);
      const pc = await pendingCounts(this.env, scope);
      await this.state.storage.put('ticks', 0);
      await this.state.storage.put('stopped', false);
      await this.state.storage.put('startedAt', now());
      await this.state.storage.put('startTotal', pc.total);
      await this.state.storage.put('history', []);
      const existing = await this.state.storage.getAlarm();
      if (!existing) await this.state.storage.setAlarm(Date.now() + 1000);
      return json({ ok: true, running: true });
    }
    if (cmd === 'stop') {
      await this.state.storage.put('stopped', true);
      await this.state.storage.deleteAlarm();
      return json({ ok: true, running: false });
    }
    return json(await this.status());
  }

  async status() {
    const alarm = await this.state.storage.getAlarm();
    const scope = (await this.state.storage.get('scope')) || 'all';
    const pending = await pendingCounts(this.env, scope);
    const startTotal = (await this.state.storage.get('startTotal')) || 0;
    const history = (await this.state.storage.get('history')) || [];
    // Rate from the last 8 batches: items per second, wall clock.
    let perSec = null;
    if (history.length >= 2) {
      const first = history[0], lastH = history[history.length - 1];
      const secs = (Date.parse(lastH.at) - Date.parse(first.at)) / 1000;
      const items = history.slice(1).reduce((a, h) => a + (h.count || 0), 0);
      if (secs > 0 && items > 0) perSec = items / secs;
    }
    const done = Math.max(0, startTotal - pending.total);
    return {
      running: !!alarm,
      scope,
      ticks: (await this.state.storage.get('ticks')) || 0,
      last: (await this.state.storage.get('last')) || null,
      startedAt: (await this.state.storage.get('startedAt')) || null,
      nextAt: alarm ? new Date(alarm).toISOString() : null,
      pending_counts: pending,
      start_total: startTotal,
      done,
      progress: startTotal > 0 ? Math.min(1, done / startTotal) : (pending.total === 0 ? 1 : 0),
      eta_seconds: perSec ? Math.round(pending.total / perSec) : null
    };
  }

  async alarm() {
    const env = this.env;
    if (await this.state.storage.get('stopped')) return;
    const ticks = ((await this.state.storage.get('ticks')) || 0) + 1;
    await this.state.storage.put('ticks', ticks);
    let stage = null, result = null;
    const scope = (await this.state.storage.get('scope')) || 'all';
    try {
      stage = await pickStage(env, scope);
      if (stage) result = await STAGES[stage](env, { scope });
    } catch (e) {
      result = { ok: false, error: e.message || String(e) };
    }
    await this.state.storage.put('last', { at: now(), stage: stage || IDLE_NOTE, count: result?.count ?? 0, ok: result?.ok ?? true, note: result?.note || result?.error || null });
    const history = ((await this.state.storage.get('history')) || []).concat([{ at: now(), stage, count: result?.count ?? 0 }]).slice(-8);
    await this.state.storage.put('history', history);
    const more = stage && ticks < MAX_TICKS;
    if (more) await this.state.storage.setAlarm(Date.now() + tickMs(env));
    else if (await aiCapped(env)) {
      // Wake again just after the allocation resets so the backfill continues without anyone pressing anything.
      const d = new Date(); d.setUTCHours(24, 5, 0, 0);
      await this.state.storage.put('ticks', 0);
      await this.state.storage.setAlarm(d.getTime());
    }
  }
}

// How much work each stage has left. Discover is counted in pages (cursor), the rest in games.
export async function pendingCounts(env, scope = 'all') {
  const db = env.DB;
  const sc = scopeSql(scope);
  const cursor = await getSetting(db, 'discover_cursor', { tag: 0, page: 0 });
  const tags = await getSetting(db, 'steam_tags', []);
  const discover = cursor.tag > 0 || cursor.page > 0 ? Math.max(1, (tags.length - cursor.tag) * 14 - cursor.page) : 0; // ~14 pages per tag, rough
  const enrich = (await db.prepare(`SELECT COUNT(*) AS n FROM games g LEFT JOIN steam_cache c ON c.appid = g.appid WHERE g.status = 'new' OR (g.status = 'error' AND COALESCE(g.error_count,0) < 5 AND (g.last_enriched IS NULL OR g.last_enriched < ?)) OR (g.status = 'enriched' AND c.news_json IS NULL${sc})`).bind(daysFromNow(-1 / 24)).first()).n;
  const matchThreshold = await worthThreshold(env);
  const matchGate = matchThreshold > 0 ? ` AND (COALESCE(k.want,0) = 1 OR (f.score IS NOT NULL AND f.score >= ${matchThreshold}))` : '';
  const match = env.PLATPRICES_KEY ? (await db.prepare(
    `SELECT COUNT(*) AS n FROM games g LEFT JOIN facets f ON f.appid = g.appid LEFT JOIN kevin k ON k.appid = g.appid
     WHERE g.status = 'enriched' AND g.psn_status IN ('unmatched','not_listed') AND g.ppid IS NULL AND (g.next_match_at IS NULL OR g.next_match_at <= ?)${matchGate}${sc}`
  ).bind(now()).first()).n : 0;
  // Games waiting on a score before they are even eligible for the match gate: informational, not part of `total`.
  const waitingOnScore = (matchThreshold > 0 && env.PLATPRICES_KEY)
    ? (await db.prepare(`SELECT COUNT(*) AS n FROM games g LEFT JOIN facets f ON f.appid = g.appid LEFT JOIN kevin k ON k.appid = g.appid
        WHERE g.status = 'enriched' AND g.psn_status IN ('unmatched','not_listed') AND g.ppid IS NULL AND (g.next_match_at IS NULL OR g.next_match_at <= ?)
          AND COALESCE(k.want,0) = 0 AND f.appid IS NULL${sc}`).bind(now()).first()).n : 0;
  const tag = (await db.prepare(`SELECT COUNT(*) AS n FROM games g LEFT JOIN facets f ON f.appid = g.appid JOIN steam_cache c ON c.appid = g.appid WHERE g.status = 'enriched' AND c.appdetails_json IS NOT NULL AND (f.appid IS NULL OR (f.confirmed_by IS NULL AND COALESCE(g.steam_pos,0)+COALESCE(g.steam_neg,0) >= 2 * COALESCE(f.reviews_at_tag, 0) + 20))${sc}`).first()).n;
  let plans = (await db.prepare(`SELECT COUNT(*) AS n FROM games g JOIN steam_cache c ON c.appid = g.appid WHERE g.status = 'enriched' AND g.ppid IS NULL AND c.news_json IS NOT NULL AND g.ps5_plan_at IS NULL AND (g.last_error IS NULL OR g.last_error NOT LIKE 'plans: %')${sc}`).first()).n;
  if (planMethod(env) === 'web' && matchThreshold > 0 && !(await claudeOverBudget(env))) {
    const minRev = Number(env.PLANS_WEB_MIN_REVIEWS) || 50;
    plans += (await db.prepare(`SELECT COUNT(*) AS n FROM games g LEFT JOIN facets f ON f.appid = g.appid WHERE g.status = 'enriched' AND g.ppid IS NULL AND g.ps5_plan_method = 'news' AND g.ps5_plan IN ('unknown','planned') AND COALESCE(f.score,-1) >= ${matchThreshold} AND COALESCE(g.steam_pos,0)+COALESCE(g.steam_neg,0) >= ${minRev}${sc}`).first()).n;
  }
  const capped = await aiCapped(env);
  return { discover, enrich, match, tag: capped ? 0 : tag, plans: capped ? 0 : plans, tag_blocked: capped ? tag : 0, plans_blocked: capped ? plans : 0, waiting_on_score: waitingOnScore, total: discover + enrich + (capped ? 0 : tag) + match + (capped ? 0 : plans) };
}

// Which stage has work, in pipeline order. Returns null when everything is drained.
export async function pickStage(env, scope = 'all') {
  if (!(await getSetting(env.DB, 'rematch_done_v1', false))) { await STAGES.rematch(env); }
  const pc = await pendingCounts(env, scope);
  if (pc.discover > 0) return 'discover';
  if (pc.enrich > 0) return 'enrich';
  if (pc.match > 0) return 'match';
  if (pc.tag > 0) return 'tag';
  if (pc.plans > 0) return 'plans';
  return null;
}

const json = (d) => new Response(JSON.stringify(d), { headers: { 'content-type': 'application/json' } });
