# First-time deploy

Run these once from a PC with Node 18+ and the repo checked out. After this, every push to `main` deploys through Cloudflare's GitHub integration.

## 1. PlatPrices key

Apply at https://platprices.com/api-request, Free plan. Describe the project as a public survivors-like genre tracker for the PlayStation Store with a taste filter, attribution shown on every page with a price. Keys arrive by email in 1 to 2 business days. Region defaults to US, which is what the worker uses.

## 2. Cloudflare resources

```
npx wrangler login
npx wrangler d1 create survivors
```

Copy the `database_id` it prints into `wrangler.jsonc` (replace `REPLACE_WITH_ID_FROM_wrangler_d1_create`). Then:

```
npx wrangler d1 migrations apply survivors --remote
npx wrangler secret put PLATPRICES_KEY      # paste the key
npx wrangler secret put ADMIN_TOKEN         # any long random string; you type it once into Settings
```

## 3. First deploy

```
npm install
npm test
npm run deploy
```

Wrangler prints the `*.workers.dev` URL. That is the site.

## 4. Connect GitHub so pushes deploy

Cloudflare dashboard, Workers & Pages, the `survivors` worker, Settings, Build. Connect the GitHub repo, branch `main`, build command `npm run build`, deploy command `npx wrangler deploy`. The D1 id and cron schedules come from `wrangler.jsonc` in the repo, so nothing else lives in the dashboard.

## 5. Seed the catalog

On the site:

1. Settings, paste the admin token, "Use this token".
2. Settings, Steam tags, "Look up id" for Bullet Heaven. If Steam's tag page shape defeats the parser, open https://store.steampowered.com/tags/en/Bullet%20Heaven/ in a browser, click through to a search, and paste the number after `tags=` in the URL. Save.
3. Queue, run `discover`. It walks the tag search and inserts every appid (several hundred).
4. Queue, `enrich` with "run until empty". Each batch is 25 games and hits Steam three times per game. Expect a few minutes.
5. Queue, `match` with "run until empty". This spends PlatPrices requests: one per game. Watch the budget line in Settings. With 400 to 600 candidates the first month's quota is mostly the initial match; that is expected and the reserve guard stops it before the last 150.
6. Queue, `tag` with "run until empty". Workers AI, free allocation; if it starts returning errors you have hit the daily cap, come back tomorrow.
7. Queue, `refresh` once. Prices are now live. Cron takes over from here.

## Cron schedule (UTC)

- 09:00 discover, refresh
- 09:30 enrich, match, tag (one batch each)
- 21:00 enrich, match, tag again (catches failures)

## Where things can break

- Steam changes its search HTML: `discover` returns 0 with no error. Fix `parseSearchHtml` in `worker/lib/steam.js`; `tests/parse.test.mjs` has the shape.
- Steam changes its tag-vote embed: tag votes go null, nothing else breaks.
- PlatPrices returns `429`: budget guard. Check Settings, wait for the 1st.
- Workers AI returns text that is not JSON: the game gets `last_error` starting with `tag:` and shows in Queue under Errors. Rerun `tag`; it retries anything without facets.
