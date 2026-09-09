// Thin D1 helpers. Every query goes through here so the SQL stays in one place per table.

export const now = () => new Date().toISOString();
export const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);
export const daysFromNow = (n) => new Date(Date.now() + n * 864e5).toISOString();

export async function getSetting(db, key, fallback = null) {
  const row = await db.prepare('SELECT value_json FROM settings WHERE key = ?').bind(key).first();
  if (!row) return fallback;
  try { return JSON.parse(row.value_json); } catch { return fallback; }
}

export async function setSetting(db, key, value) {
  await db.prepare('INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json')
    .bind(key, JSON.stringify(value)).run();
}

export async function startRun(db, stage) {
  const r = await db.prepare('INSERT INTO run_log (stage, started_at) VALUES (?, ?) RETURNING id').bind(stage, now()).first();
  return r.id;
}

export async function endRun(db, id, ok, count, error = null) {
  await db.prepare('UPDATE run_log SET finished_at = ?, ok = ?, count = ?, error = ? WHERE id = ?')
    .bind(now(), ok ? 1 : 0, count, error ? String(error).slice(0, 1000) : null, id).run();
}

export async function lastRuns(db) {
  const { results } = await db.prepare(
    `SELECT r.* FROM run_log r
     JOIN (SELECT stage, MAX(id) AS id FROM run_log GROUP BY stage) m ON m.id = r.id
     ORDER BY r.stage`
  ).all();
  return results;
}

export async function upsertGameFromSteamSearch(db, { appid, name, source }) {
  const r = await db.prepare(
    `INSERT INTO games (appid, name, source, first_seen) VALUES (?, ?, ?, ?)
     ON CONFLICT(appid) DO NOTHING`
  ).bind(appid, name, source, now()).run();
  return r.meta.changes > 0;
}

// Budget: mirror PlatPrices' headers so the worker can refuse to spend past the reserve.
export async function readBudget(db) {
  const m = monthKey();
  let row = await db.prepare('SELECT * FROM api_budget WHERE month = ?').bind(m).first();
  if (!row) {
    await db.prepare('INSERT INTO api_budget (month, used, remaining, reserve) VALUES (?, 0, NULL, 150)').bind(m).run();
    row = { month: m, used: 0, remaining: null, reserve: 150 };
  }
  return row;
}

export async function noteBudgetHeaders(db, headers) {
  const used = Number(headers.get('X-RateLimit-Used'));
  const remaining = Number(headers.get('X-RateLimit-Remaining'));
  if (!Number.isFinite(remaining)) return;
  await db.prepare(
    `INSERT INTO api_budget (month, used, remaining, reserve, last_header_at) VALUES (?, ?, ?, 150, ?)
     ON CONFLICT(month) DO UPDATE SET used = excluded.used, remaining = excluded.remaining, last_header_at = excluded.last_header_at`
  ).bind(monthKey(), Number.isFinite(used) ? used : 0, remaining, now()).run();
}

// Can we spend `n` more requests without eating the reserve? Unknown remaining (fresh month) = yes.
export async function canSpend(db, n = 1) {
  const b = await readBudget(db);
  if (b.remaining == null) return true;
  return b.remaining - n >= (b.reserve ?? 150);
}
