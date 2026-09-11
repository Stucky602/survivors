// Workers AI wrapper. One job: send a system + user prompt, get back a parsed JSON object, never throw on parse.

// Strip what breaks a JSON request body: lone surrogates (half an emoji from a Steam post) and control characters.
export function scrub(text) {
  let t = String(text || '');
  if (typeof t.toWellFormed === 'function') t = t.toWellFormed();
  else t = t.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '').replace(/(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '$1');
  return t.replace(/\uFFFD/g, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ');
}

export const CAP_RE = /quota|limit|429|exceed|neurons|allocation|4006/i;
export const isCapError = (e) => CAP_RE.test(String(e && e.message || e));

// Claude via the Messages API. Used for the tag step when ANTHROPIC_API_KEY is set; one subrequest per call.
// Per-million-token prices and per-search price. Haiku 4.5 and Sonnet 5 as of Sep 2026; override with CLAUDE_PRICE_IN / CLAUDE_PRICE_OUT if they change.
function prices(env, model) {
  const sonnet = /sonnet/i.test(model);
  return { inM: Number(env.CLAUDE_PRICE_IN) || (sonnet ? 2 : 1), outM: Number(env.CLAUDE_PRICE_OUT) || (sonnet ? 10 : 5), search: 0.01 };
}
const monthKey = () => new Date().toISOString().slice(0, 7);

export async function claudeSpend(env) {
  const row = await env.DB.prepare('SELECT value_json FROM settings WHERE key = ?').bind(`claude_spend_${monthKey()}`).first();
  const sp = row ? JSON.parse(row.value_json) : { usd: 0, calls: 0, searches: 0, input: 0, output: 0 };
  const cap = Number(env.CLAUDE_BUDGET_USD);
  return { ...sp, cap: Number.isFinite(cap) ? cap : 5, month: monthKey() };
}
export async function claudeOverBudget(env) { const s = await claudeSpend(env); return s.usd >= s.cap; }
async function recordSpend(env, model, usage, searches) {
  const pr = prices(env, model);
  const inTok = (usage && usage.input_tokens) || 0, outTok = (usage && usage.output_tokens) || 0;
  const cacheIn = (usage && ((usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0))) || 0;
  const usd = ((inTok + cacheIn) / 1e6) * pr.inM + (outTok / 1e6) * pr.outM + searches * pr.search;
  const cur = await claudeSpend(env);
  const next = { usd: +(cur.usd + usd).toFixed(4), calls: cur.calls + 1, searches: cur.searches + searches, input: cur.input + inTok + cacheIn, output: cur.output + outTok };
  await env.DB.prepare('INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json').bind(`claude_spend_${monthKey()}`, JSON.stringify(next)).run();
  return usd;
}

export async function runClaude(env, { system, user, maxTokens, webSearch = false, maxSearches = 2 }) {
  const model = env.CLAUDE_MODEL || 'claude-haiku-4-5';
  if (await claudeOverBudget(env)) throw new Error('claude 402: monthly budget cap reached (CLAUDE_BUDGET_USD); raise it on the worker to continue');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort('timeout'), webSearch ? 120000 : 60000);
  try {
    const body = { model, max_tokens: maxTokens, temperature: 0, system: scrub(system), messages: [{ role: 'user', content: scrub(user) }] };
    if (webSearch) body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxSearches }];
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body)
    });
    const j = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`claude ${res.status}: ${(j && j.error && j.error.message) || 'request failed'}`);
    const texts = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text);
    const text = texts.join('\n');
    // The JSON is in the final text block; earlier blocks are the model narrating its searches.
    const json = extractJSON(texts[texts.length - 1] || '') || extractJSON(text);
    const searches = (j.usage && j.usage.server_tool_use && j.usage.server_tool_use.web_search_requests) || (j.content || []).filter((c) => c.type === 'server_tool_use').length;
    const usd = await recordSpend(env, model, j.usage, searches);
    return { model: webSearch ? `${model}+web` : model, text, json, searches, usage: j.usage || null, usd };
  } finally { clearTimeout(timer); }
}

export async function runJSON(env, { system, user, maxTokens = 1200, model: modelOverride, job = null }) {
  if (job === 'tag' && env.ANTHROPIC_API_KEY) return runClaude(env, { system, user, maxTokens });
  const model = modelOverride || env.AI_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
  const sys = scrub(system), usr = scrub(user);
  let last = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await env.AI.run(model, {
      messages: [{ role: 'system', content: sys }, { role: 'user', content: attempt ? `${usr}\n\nReply with the JSON object only.` : usr }],
      max_tokens: maxTokens,
      temperature: attempt ? 0 : 0.1
    });
    const text = typeof res === 'string' ? res : (res && (res.response || res.result || '')) || '';
    const json = extractJSON(text);
    last = { model, text, json };
    if (json) return last;
  }
  return last;
}

// Pull the first balanced {...} out of model text, tolerating code fences and preambles.
export function extractJSON(text) {
  if (!text) return null;
  let t = String(text).replace(/```(?:json)?/gi, '').trim();
  const start = t.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { try { return JSON.parse(t.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}
