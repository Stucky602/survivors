// All fetches go through here. Admin token lives in localStorage after being typed once on Settings.

export const getToken = () => localStorage.getItem('survivors.token') || '';
export const setToken = (t) => localStorage.setItem('survivors.token', t || '');

export async function api(path, { method = 'GET', body, admin = false } = {}) {
  const headers = { Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (admin) headers.Authorization = `Bearer ${getToken()}`;
  const res = await fetch(`/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const getLocalTaste = () => { try { return JSON.parse(localStorage.getItem('survivors.taste') || 'null'); } catch { return null; } };
export const setLocalTaste = (t) => localStorage.setItem('survivors.taste', t ? JSON.stringify(t) : '');

export const money = (cents) => (cents == null ? '' : `$${(cents / 100).toFixed(2)}`);
export const fmtDate = (s) => (s ? String(s).slice(0, 10) : '');

export const daysUntil = (s) => { if (!s) return null; const t = new Date(String(s).replace(' ', 'T') + (String(s).endsWith('Z') ? '' : 'Z')).getTime(); if (!Number.isFinite(t)) return null; return Math.ceil((t - Date.now()) / 864e5); };
export const getPsPlus = () => localStorage.getItem('survivors.psplus') || 'none';
export const setPsPlus = (v) => localStorage.setItem('survivors.psplus', v);
// "Since last visit" means the previous sitting, not the previous page load. A visit older than 6 hours rolls over.
export const getLastVisit = () => localStorage.getItem('survivors.lastVisit') || '';
export const markVisit = () => {
  const cur = localStorage.getItem('survivors.visitStart');
  if (!cur || Date.now() - Date.parse(cur) > 6 * 36e5) {
    if (cur) localStorage.setItem('survivors.lastVisit', cur);
    localStorage.setItem('survivors.visitStart', new Date().toISOString());
  }
};
export const getFilters = (key, fallback) => { try { return { ...fallback, ...(JSON.parse(localStorage.getItem(`survivors.filters.${key}`) || 'null') || {}) }; } catch { return fallback; } };
export const setFilters = (key, f) => localStorage.setItem(`survivors.filters.${key}`, JSON.stringify(f));
export const getCompare = () => { try { return JSON.parse(localStorage.getItem('survivors.compare') || '[]'); } catch { return []; } };
export const setCompare = (ids) => localStorage.setItem('survivors.compare', JSON.stringify(ids));
export function toCSV(rows) {
  const cols = ['appid', 'name', 'developer', 'score', 'category', 'combat_class', 'hub_type', 'prestige', 'progression_depth', 'base_price', 'sale_price', 'on_sale', 'sale_ends', 'psn_rating', 'psn_ratings', 'steam_pos', 'steam_neg', 'owned', 'want', 'psn_url'];
  const esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const lines = [cols.join(',')];
  for (const g of rows) {
    const f = g.facets || {}, p = g.psn || {};
    lines.push([g.appid, g.name, g.developer, g.score, g.category, f.combat_class, f.hub_type, f.prestige, f.progression_depth, p.base_price, p.sale_price, p.is_on_sale ? 1 : 0, p.discounted_until, p.star_rating, p.star_count, g.steam_pos, g.steam_neg, g.owned ? 1 : 0, g.want ? 1 : 0, p.url].map(esc).join(','));
  }
  return lines.join('\n');
}
export function download(name, text, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
