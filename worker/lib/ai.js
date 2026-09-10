// Workers AI wrapper. One job: send a system + user prompt, get back a parsed JSON object, never throw on parse.

export async function runJSON(env, { system, user, maxTokens = 1200 }) {
  const model = env.AI_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
  let last = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await env.AI.run(model, {
      messages: [{ role: 'system', content: system }, { role: 'user', content: attempt ? `${user}\n\nReply with the JSON object only.` : user }],
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
