// PlatPrices API v2. Every call spends one request from a 1,000/month Free quota, so callers check canSpend() first.
import { noteBudgetHeaders } from './db.js';

const BASE = 'https://platprices.com/api/v2';

export const GAME_FIELDS = [
  'PPID', 'PSNID', 'ProductName', 'Img', 'PSStoreURL', 'PlatPricesURL', 'ConceptID', 'StoreClass', 'EditionName',
  'IsPS4', 'IsPS5', 'IsDLC', 'IsDemoOrSoundtrack', 'IsPreorder', 'IsDelisted', 'IsOnSale',
  'BasePrice', 'SalePrice', 'PlusPrice', 'DiscPerc', 'DiscountedUntil',
  'formattedBasePrice', 'formattedSalePrice', 'formattedPlusPrice',
  'LowestEverPrice', 'StarRating', 'StarRatingCount', 'PSPExtra', 'PSPPremium',
  'ReleaseDate', 'ShortDesc', 'Desc', 'Publisher', 'Developer'
].join(',');

async function call(env, path, params = {}) {
  if (!env.PLATPRICES_KEY) throw new Error('PLATPRICES_KEY secret is not set');
  const url = new URL(BASE + path);
  url.searchParams.set('region', (env.REGION || 'US').toLowerCase());
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort('timeout'), 15000);
  let res;
  try { res = await fetch(url, { signal: ctl.signal, headers: { 'X-API-Key': env.PLATPRICES_KEY, Accept: 'application/json' } }); }
  finally { clearTimeout(timer); }
  await noteBudgetHeaders(env.DB, res.headers);
  const j = await res.json().catch(() => null);
  if (!j || j.success !== true) {
    const code = j && j.error ? j.error.code : `HTTP ${res.status}`;
    throw new Error(`platprices ${code}: ${j && j.error ? j.error.message : ''}`);
  }
  return j;
}

export async function searchGames(env, q) {
  const j = await call(env, '/games/search', { q, fields: GAME_FIELDS });
  return j.data || [];
}

export async function batch(env, ppids) {
  const j = await call(env, '/games/batch', { ppids: ppids.join(','), fields: GAME_FIELDS });
  return { data: j.data || [], missing: (j.meta && j.meta.missing) || [] };
}

export async function status(env) {
  const j = await call(env, '/status');
  return j.data;
}

const toInt = (v) => (v == null || v === '' ? null : Number(v));

// Map a PlatPrices game object onto the psn_products row.
export function toProductRow(g, appid) {
  return {
    ppid: toInt(g.PPID), appid, concept_id: toInt(g.ConceptID),
    product_name: g.ProductName || null, edition: g.EditionName || null, store_class: g.StoreClass || null,
    psn_url: g.PSStoreURL || null, pp_url: g.PlatPricesURL || null, img: g.Img || null,
    is_ps4: toInt(g.IsPS4) || 0, is_ps5: toInt(g.IsPS5) || 0,
    is_preorder: toInt(g.IsPreorder) || 0, is_delisted: toInt(g.IsDelisted) || 0, is_on_sale: toInt(g.IsOnSale) || 0,
    base_price: toInt(g.BasePrice), sale_price: toInt(g.SalePrice), plus_price: toInt(g.PlusPrice),
    disc_perc: toInt(g.DiscPerc) || 0, discounted_until: g.DiscountedUntil || null,
    f_base: g.formattedBasePrice || null, f_sale: g.formattedSalePrice || null, f_plus: g.formattedPlusPrice || null,
    star_rating: g.StarRating == null ? null : Number(g.StarRating), star_count: toInt(g.StarRatingCount),
    psp_extra: toInt(g.PSPExtra) || 0, psp_premium: toInt(g.PSPPremium) || 0,
    lowest_ever: toInt(g.LowestEverPrice),
    release_date: g.ReleaseDate || null, short_desc: g.ShortDesc || null, desc: g.Desc || null
  };
}

export const PRODUCT_COLS = ['ppid', 'appid', 'concept_id', 'product_name', 'edition', 'store_class', 'psn_url', 'pp_url', 'img', 'is_ps4', 'is_ps5', 'is_preorder', 'is_delisted', 'is_on_sale', 'base_price', 'sale_price', 'plus_price', 'disc_perc', 'discounted_until', 'f_base', 'f_sale', 'f_plus', 'star_rating', 'star_count', 'psp_extra', 'psp_premium', 'lowest_ever', 'release_date', 'short_desc', 'desc'];

export async function upsertProduct(db, row, observedAt) {
  const prev = await db.prepare('SELECT base_price, sale_price, plus_price, lowest_seen FROM psn_products WHERE ppid = ?').bind(row.ppid).first();
  const cols = PRODUCT_COLS;
  const sets = cols.filter((c) => c !== 'ppid').map((c) => `${c} = excluded.${c}`).join(', ');
  const lowestSeen = Math.min(...[prev?.lowest_seen, row.sale_price, row.plus_price].filter((v) => v != null && Number.isFinite(v)));
  await db.prepare(
    `INSERT INTO psn_products (${cols.join(', ')}, lowest_seen, refreshed_at) VALUES (${cols.map(() => '?').join(', ')}, ?, ?)
     ON CONFLICT(ppid) DO UPDATE SET ${sets}, lowest_seen = excluded.lowest_seen, refreshed_at = excluded.refreshed_at`
  ).bind(...cols.map((c) => row[c] ?? null), Number.isFinite(lowestSeen) ? lowestSeen : null, observedAt).run();
  const changed = !prev || prev.base_price !== row.base_price || prev.sale_price !== row.sale_price || prev.plus_price !== row.plus_price;
  if (changed) {
    await db.prepare('INSERT INTO price_snapshots (ppid, observed_at, base_price, sale_price, plus_price) VALUES (?, ?, ?, ?, ?)')
      .bind(row.ppid, observedAt, row.base_price, row.sale_price, row.plus_price).run();
  }
  return changed;
}

export async function markDelisted(db, ppids, observedAt) {
  for (const ppid of ppids) await db.prepare('UPDATE psn_products SET is_delisted = 1, is_on_sale = 0, refreshed_at = ? WHERE ppid = ?').bind(observedAt, ppid).run();
}
