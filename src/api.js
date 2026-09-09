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
