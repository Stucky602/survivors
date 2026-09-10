CREATE TABLE IF NOT EXISTS games (
  appid INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  steam_release TEXT,
  coming_soon INTEGER DEFAULT 0,
  developer TEXT,
  publisher TEXT,
  header_img TEXT,
  early_access INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new',
  psn_status TEXT NOT NULL DEFAULT 'unmatched',
  ppid INTEGER,
  concept_id INTEGER,
  tag_votes INTEGER,
  steam_pos INTEGER,
  steam_neg INTEGER,
  steam_score_desc TEXT,
  last_update_seen TEXT,
  source TEXT,
  first_seen TEXT NOT NULL,
  last_enriched TEXT,
  next_match_at TEXT,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS games_status ON games(status, psn_status);

CREATE TABLE IF NOT EXISTS steam_cache (
  appid INTEGER PRIMARY KEY,
  appdetails_json TEXT,
  appreviews_json TEXT,
  tag_votes_json TEXT,
  fetched_at TEXT
);

CREATE TABLE IF NOT EXISTS psn_products (
  ppid INTEGER PRIMARY KEY,
  appid INTEGER,
  concept_id INTEGER,
  product_name TEXT,
  edition TEXT,
  store_class TEXT,
  psn_url TEXT,
  pp_url TEXT,
  img TEXT,
  is_ps4 INTEGER, is_ps5 INTEGER,
  is_preorder INTEGER, is_delisted INTEGER, is_on_sale INTEGER,
  base_price INTEGER, sale_price INTEGER, plus_price INTEGER,
  disc_perc INTEGER,
  discounted_until TEXT,
  f_base TEXT, f_sale TEXT, f_plus TEXT,
  star_rating REAL, star_count INTEGER,
  psp_extra INTEGER, psp_premium INTEGER,
  lowest_ever INTEGER,
  lowest_seen INTEGER,
  release_date TEXT,
  short_desc TEXT,
  desc TEXT,
  refreshed_at TEXT
);
CREATE INDEX IF NOT EXISTS psn_appid ON psn_products(appid);

CREATE TABLE IF NOT EXISTS price_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ppid INTEGER NOT NULL,
  observed_at TEXT NOT NULL,
  base_price INTEGER, sale_price INTEGER, plus_price INTEGER
);
CREATE INDEX IF NOT EXISTS snap_ppid ON price_snapshots(ppid, observed_at);

CREATE TABLE IF NOT EXISTS facets (
  appid INTEGER PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 1,
  facets_json TEXT NOT NULL,
  evidence_json TEXT,
  proposed_json TEXT,
  model TEXT,
  tagged_at TEXT,
  reviews_at_tag INTEGER DEFAULT 0,
  confirmed_by TEXT,
  confirmed_at TEXT,
  needs_review INTEGER DEFAULT 0,
  score INTEGER,
  category TEXT
);

CREATE TABLE IF NOT EXISTS match_candidates (
  appid INTEGER PRIMARY KEY,
  candidates_json TEXT,
  ai_json TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS kevin (
  appid INTEGER PRIMARY KEY,
  owned INTEGER DEFAULT 0,
  never INTEGER DEFAULT 0,
  note TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS run_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stage TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  ok INTEGER,
  count INTEGER DEFAULT 0,
  error TEXT
);
CREATE INDEX IF NOT EXISTS runlog_stage ON run_log(stage, started_at);

CREATE TABLE IF NOT EXISTS api_budget (
  month TEXT PRIMARY KEY,
  used INTEGER DEFAULT 0,
  remaining INTEGER,
  reserve INTEGER DEFAULT 150,
  last_header_at TEXT
);
