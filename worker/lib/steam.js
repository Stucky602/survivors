// Steam: three free, keyless sources. No API key exists for any of them.

const UA = 'survivors-tracker/0.1 (personal PSN genre tracker)';
const COOKIE = 'birthtime=568022401; wants_mature_content=1; lastagecheckage=1-January-1988';

async function getText(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.8', Cookie: COOKIE, ...(init.headers || {}) } });
  if (!res.ok) throw new Error(`steam ${res.status} ${url}`);
  return res.text();
}
async function getJSON(url) {
  const t = await getText(url);
  try { return JSON.parse(t); } catch { throw new Error(`steam non-JSON at ${url}`); }
}

// Store search by tag. json=1 returns { results_html, total_count }; the items are only in the HTML.
export function parseSearchHtml(html) {
  const out = [];
  const re = /<a[^>]*data-ds-appid="(\d+)"[^>]*>[\s\S]*?<span class="title">([\s\S]*?)<\/span>/g;
  let m;
  while ((m = re.exec(html))) out.push({ appid: Number(m[1]), name: decodeEntities(m[2].trim()) });
  return out;
}

export async function searchByTag(tagId, start = 0, count = 50) {
  const url = `https://store.steampowered.com/search/results/?query&start=${start}&count=${count}&tags=${tagId}&category1=998&json=1&infinite=1&cc=us&l=english&supportedlang=english`;
  const j = await getJSON(url);
  return { items: parseSearchHtml(j.results_html || ''), total: Number(j.total_count || 0) };
}

export async function appDetails(appid) {
  const j = await getJSON(`https://store.steampowered.com/api/appdetails?appids=${appid}&cc=us&l=english`);
  const e = j && j[String(appid)];
  if (!e || !e.success) return null;
  return e.data;
}

export async function appReviews(appid, n = 20) {
  return getJSON(`https://store.steampowered.com/appreviews/${appid}?json=1&language=english&filter=all&purchase_type=all&review_type=all&num_per_page=${n}&cursor=*`);
}

// Tag vote counts are embedded in the store page as InitAppTagModal( appid, [ {tagid,name,count}, ... ] ).
export function parseTagVotes(html) {
  const m = /InitAppTagModal\(\s*\d+\s*,\s*(\[[\s\S]*?\])\s*,/.exec(html);
  if (!m) return null;
  try { return JSON.parse(m[1]).map((t) => ({ tagid: t.tagid, name: t.name, count: t.count })); } catch { return null; }
}

export async function tagVotes(appid) {
  try {
    const html = await getText(`https://store.steampowered.com/app/${appid}/?cc=us&l=english`);
    return parseTagVotes(html);
  } catch { return null; }
}

// Resolve a tag name to its numeric id from the tag hub page. Returns null when the page shape changes.
export function parseTagId(html) {
  const m = /[?&]tags=(\d+)/.exec(html) || /"tagid"\s*:\s*(\d+)/.exec(html) || /data-tagid="(\d+)"/.exec(html);
  return m ? Number(m[1]) : null;
}
export async function resolveTagId(name) {
  const html = await getText(`https://store.steampowered.com/tags/en/${encodeURIComponent(name)}/`);
  return parseTagId(html);
}

export function stripHtml(s) {
  return String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

export function decodeEntities(s) {
  return String(s).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
