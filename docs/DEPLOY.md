# Deploy (browser only)

Everything is done in the GitHub and Cloudflare dashboards. No terminal.

## Already done (Sep 9)

- D1 database `survivors` created; its id is in `wrangler.jsonc`.
- Tables created from `migrations/0001_init.sql` via the D1 console.
- Worker `survivors` connected to the GitHub repo. Deploy command: `npm run build && npx wrangler deploy`.
- `workers_dev: true` in `wrangler.jsonc`, so the site is at `survivors.<subdomain>.workers.dev`.

## Each new migration

When a zip adds a file under `migrations/`, run its statements in the D1 console (Cloudflare → Storage & Databases → D1 → survivors → Console). Paste the file's contents as one block, Execute, then `/tables` or a `SELECT` to confirm. Keep comments out of what you paste; the console reads `--` to end of line and breaks on the next statement.

For v0.2, paste this:

```
ALTER TABLE kevin ADD COLUMN want INTEGER DEFAULT 0; ALTER TABLE kevin ADD COLUMN want_price INTEGER; ALTER TABLE kevin ADD COLUMN want_at TEXT; ALTER TABLE kevin ADD COLUMN verdict TEXT; ALTER TABLE games ADD COLUMN matched_at TEXT;
```

Run it before pushing the v0.2 code. The worker reads those columns on every page.

For v0.6.1, paste this:

```
ALTER TABLE games ADD COLUMN ps5_plan_platform TEXT;
```

For v0.6, paste this:

```
ALTER TABLE steam_cache ADD COLUMN news_json TEXT; ALTER TABLE games ADD COLUMN ps5_plan TEXT; ALTER TABLE games ADD COLUMN ps5_plan_date TEXT; ALTER TABLE games ADD COLUMN ps5_plan_window TEXT; ALTER TABLE games ADD COLUMN ps5_plan_note TEXT; ALTER TABLE games ADD COLUMN ps5_plan_at TEXT;
```

For v0.4, paste this:

```
ALTER TABLE games ADD COLUMN error_count INTEGER DEFAULT 0;
```

## Secrets

Worker → Settings → Variables and Secrets. Two secrets:

- `ADMIN_TOKEN`: any long random string. You type it once into the site's Settings page.
- `PLATPRICES_KEY`: from platprices.com/api-request, Free plan. Say yes to attribution; the site shows "Powered by PlatPrices" in the footer and on every price.

The site runs without `PLATPRICES_KEY`; only the match, refresh, and attach steps need it.

## Seeding the catalog (v0.5 and later)

Settings: paste the admin token, look up the Bullet Heaven tag id (723991), save. Queue: press **Run everything**. Leave the tab open or not; the Runner works in the background, one batch every 45 seconds, and stops when done. Match and price steps wait for the PlatPrices key and pick up on their own once it is added. That is the whole procedure.

## Seeding the catalog (manual, pre-v0.5)

On the site:

1. Settings, paste the admin token, "Use this token".
2. Settings, Steam tags, "Look up id" for Bullet Heaven. If the lookup fails, open store.steampowered.com/tags/en/Bullet%20Heaven/ in a browser, click into a search, and paste the number after `tags=` from the URL.
3. Queue, run `discover`. Several hundred appids land.
4. Queue, `enrich` with the ↻ button (run until empty). Steam only, no key needed.
5. Queue, `match` with ↻. Needs the PlatPrices key. One request per game; the budget guard stops at 150 remaining.
6. Queue, `tag` with ↻. Workers AI, free allocation. If it errors, the daily cap is hit; come back tomorrow.
7. Queue, `refresh` once. Prices live. Cron takes over: 09:00 UTC discover + refresh, 09:30 and 21:00 enrich + match + tag.

## When something is wrong

- Build fails with `CommaExpected` or similar: `wrangler.jsonc` has a syntax slip. Every entry except the last needs a trailing comma.
- Build fails with `assets.directory does not exist`: the deploy command lost its `npm run build &&` prefix.
- Site loads but `/api/health` errors: the D1 binding name is not `DB` or the AI binding is not `AI`. Check Worker → Settings → Bindings.
- `discover` returns 0 with no error: Steam changed its search HTML. `worker/lib/steam.js` `parseSearchHtml` needs a new pattern.
- Home shows "Can't reach the worker": the deploy is mid-flight or failed; check the build log.


## Optional paid switches (v0.7)

**Workers Paid ($5/month).** Cloudflare dashboard → Workers & Pages → Plans (or the "Upgrade" link on the Workers overview) → Workers Paid. Then Worker → Settings → Variables and Secrets → set `PLAN` to `paid`. Batches grow automatically; nothing else to change.

**Claude for tagging (a few dollars once).** Claude Console (platform.claude.com) → create an account → Billing, add a small credit → API keys, create one. Worker → Settings → Variables and Secrets → add secret `ANTHROPIC_API_KEY`. Tagging switches over on the next run. `CLAUDE_MODEL` can be changed to `claude-sonnet-5` for stronger judgment at about twice the cost.
