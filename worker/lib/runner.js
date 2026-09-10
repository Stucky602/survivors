// The Runner: a Durable Object that drains the pipeline one batch per alarm.
// Each alarm is its own Worker invocation with its own 50-subrequest budget, which is the only way
// to backfill several hundred games on the free plan without a human clicking a button per batch.
import { STAGES } from './stages.js';
import { getSetting, daysFromNow, now } from './db.js';

const TICK_MS = 45000;      // between batches
const MAX_TICKS = 400;      // safety: stops on its own after ~5 hours of continuous work
const IDLE_NOTE = 'idle';

export class Runner {
  constructor(state, env) { this.state = state; this.env = env; }

  async fetch(request) {
    const url = new URL(request.url);
    const cmd = url.pathname.split('/').pop();
    if (cmd === 'start') {
      await this.state.storage.put('ticks', 0);
      await this.state.storage.put('stopped', false);
      await this.state.storage.put('startedAt', now());
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
    return {
      running: !!alarm,
      ticks: (await this.state.storage.get('ticks')) || 0,
      last: (await this.state.storage.get('last')) || null,
      startedAt: (await this.state.storage.get('startedAt')) || null,
      nextAt: alarm ? new Date(alarm).toISOString() : null
    };
  }

  async alarm() {
    const env = this.env;
    if (await this.state.storage.get('stopped')) return;
    const ticks = ((await this.state.storage.get('ticks')) || 0) + 1;
    await this.state.storage.put('ticks', ticks);
    let stage = null, result = null;
    try {
      stage = await pickStage(env);
      if (stage) result = await STAGES[stage](env, {});
    } catch (e) {
      result = { ok: false, error: e.message || String(e) };
    }
    await this.state.storage.put('last', { at: now(), stage: stage || IDLE_NOTE, count: result?.count ?? 0, ok: result?.ok ?? true, note: result?.note || result?.error || null });
    const more = stage && ticks < MAX_TICKS;
    if (more) await this.state.storage.setAlarm(Date.now() + TICK_MS);
  }
}

// Which stage has work, in pipeline order. Returns null when everything is drained.
export async function pickStage(env) {
  const db = env.DB;
  const cursor = await getSetting(db, 'discover_cursor', { tag: 0, page: 0 });
  if (cursor.tag > 0 || cursor.page > 0) return 'discover';
  const enrichable = await db.prepare(
    `SELECT COUNT(*) AS n FROM games WHERE status = 'new' OR (status = 'error' AND COALESCE(error_count,0) < 5 AND (last_enriched IS NULL OR last_enriched < ?))`
  ).bind(daysFromNow(-1 / 24)).first();
  if (enrichable.n > 0) return 'enrich';
  if (env.PLATPRICES_KEY) {
    const matchable = await db.prepare(
      `SELECT COUNT(*) AS n FROM games WHERE status = 'enriched' AND psn_status IN ('unmatched','not_listed') AND ppid IS NULL AND (next_match_at IS NULL OR next_match_at <= ?)`
    ).bind(now()).first();
    if (matchable.n > 0) return 'match';
  }
  const taggable = await db.prepare(
    `SELECT COUNT(*) AS n FROM games g LEFT JOIN facets f ON f.appid = g.appid JOIN steam_cache c ON c.appid = g.appid
     WHERE g.status = 'enriched' AND c.appdetails_json IS NOT NULL AND (f.appid IS NULL OR (f.confirmed_by IS NULL AND COALESCE(g.steam_pos,0)+COALESCE(g.steam_neg,0) >= 2 * COALESCE(f.reviews_at_tag, 0) + 20))
       AND (g.last_error IS NULL OR g.last_error NOT LIKE 'tag: %daily%')`
  ).first();
  if (taggable.n > 0) return 'tag';
  const plannable = await db.prepare(
    `SELECT COUNT(*) AS n FROM games g JOIN steam_cache c ON c.appid = g.appid WHERE g.status = 'enriched' AND g.ppid IS NULL AND c.news_json IS NOT NULL AND g.ps5_plan_at IS NULL AND (g.last_error IS NULL OR g.last_error NOT LIKE 'plans: %daily%')`
  ).first();
  if (plannable.n > 0) return 'plans';
  return null;
}

const json = (d) => new Response(JSON.stringify(d), { headers: { 'content-type': 'application/json' } });
