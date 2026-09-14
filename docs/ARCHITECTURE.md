# Survivors-like PSN tracker: architecture v0.1

Status: v0.11 built Sep 11 2026. Sections 1 to 6 describe what is in the repo; sections 9 to 11 list what v0.2 to v0.4 added.
Decisions already made in chat: public site, one real user, $0/month, hybrid tagging (AI first pass, Kevin confirms high scorers), hub is both a filter and a weight.

## 1. What the site does

Tracks every survivors-like on Steam, finds out which ones are on the US PlayStation Store, watches their prices, and ranks them against Kevin's taste profile.

Four pages plus two admin pages:

| Page | What it shows |
|---|---|
| Home | What changed since the last visit: sales ending in 3 days, new sales, new PS Store listings, preorders releasing inside 30 days, the wanted list with price drops, and the best unowned fits. |
| Compare | Two or three games side by side on every facet, price, and rating, best value per row marked. |
| Upcoming | Games not out anywhere yet, plus PS Store preorders. Real dates where they exist. |
| On Steam | Released on Steam, no PS Store listing. Grouped by what the developer has said about a PlayStation release. |
| On sale | Matched games where `IsOnSale = 1`, with sale end date, discount, and whether this is the lowest price the site has seen. |
| Browse | The whole matched catalog with the facet filters and the score. |
| Game | One game: facts, evidence, price line, links to Steam and PS Store. |
| Queue (admin) | Three lists: PSN matches to confirm, facet tags to confirm (score >= 70), games with stale data. |
| Settings (admin) | Weight sliders, hard-gate toggles, owned/never lists, Steam tag set, API budget readout. |

Admin pages need a token typed once into the browser. Public pages need nothing.

## 2. Data flow

```
Steam tag pages ──> candidates ──> Steam enrich ──> PSN match ──> price refresh ──> facet tagging ──> score
   (daily)          (D1)          (on new, weekly)   (on new,       (daily)          (on new,        (client-side,
                                                     retry weekly)                    on review       from weights)
                                                                                      growth)
```

Every stage writes to D1. Every stage is a separate function with its own row in `run_log`. A stage failing does not stop the next cron tick from running the others.

### 2.1 Discover (daily)

Source: Steam store search with tag filters. Steam's search results endpoint returns JSON when asked (`/search/results/?json=1&infinite=1&tags=...`). Tag IDs get resolved once from the tag hub page at build time and stored in settings, not hardcoded.

Default tag set: Bullet Heaven. Secondary: Roguelite AND (Action Roguelike OR Auto Battler), admitted only if the store page text mentions auto-attack, auto-fire, or survivors. Kevin can edit the set in Settings.

Output: rows in `games` keyed by Steam appid. New rows get `status = 'new'`.

### 2.2 Steam enrich (on new, then weekly)

Two free, keyless endpoints:

- `store.steampowered.com/api/appdetails?appids=N`: name, short and long description, release date, genres, developer, publisher, header image, Metacritic score if any.
- `store.steampowered.com/appreviews/N?json=1&language=english&filter=all&num_per_page=20`: review summary, total positive and negative, and the 20 most helpful reviews.

Plus one HTML fetch of the store page for tag vote counts (embedded as JSON in the page). Age-gated pages need the `birthtime` cookie. If the fetch fails the tag counts stay null and the game is still processed.

Stored raw in `steam_cache` so the tagging stage can rerun without refetching.

### 2.3 PSN match (on new, retry weekly for unmatched)

1. `GET /api/v2/games/search?q=<steam name>&region=us` on PlatPrices. One request, up to 200 name matches.
2. Workers AI reads the Steam entry and the candidate list and returns `{ppid, confidence, reason}` or `no_match`. Rules: prefer `StoreClass = FULL_GAME`, prefer the standard edition, group by `ConceptID`.
3. confidence >= 0.9: accept. 0.6 to 0.9: Queue. Below 0.6 or no candidates: `psn_status = 'not_listed'`, retry in 7 days.

A game that stays `not_listed` is by definition Upcoming. Nothing else has to be built for that section.

### 2.4 Price refresh (daily)

`GET /api/v2/games/batch?ppids=...&region=us`, 25 per call (Free plan page size). Fields requested: prices, `IsOnSale`, `DiscPerc`, `DiscountedUntil`, `IsPreorder`, `IsDelisted`, `StarRating`, `StarRatingCount`, `PSPExtra`, `PSPPremium`, `LowestEverPrice`.

Budget math on the Free plan (1,000 requests/month):

| Matched games | Batch calls/day | Calls/month |
|---|---|---|
| 250 | 10 | 300 |
| 500 | 20 | 600 |
| 600 | 24 | 720 |

Reserve 150/month for searches and retries. The worker reads `X-RateLimit-Remaining` on every response and stops price refreshes for the month when it drops below the reserve; the site shows "prices last refreshed <date>" rather than failing silently. Hard cap on matched games: 600. Past that, oldest-unowned-lowest-score games drop to weekly refresh.

Price history: the Free plan returns none, so the site keeps its own. A `price_snapshots` row is written only when a price changes, so the table stays small. This is the site's own observation log of its own watchlist, which the terms allow ("cache results in your own database"). It is not a mirror of the catalogue. "Lowest seen" on the site means lowest the site has seen, and says so.

Attribution: "Prices via PlatPrices" with a link, on every page that shows a price. Required on the Free plan.

### 2.5 Facet tagging (on new, and again when the Steam review count doubles)

Input corpus per game, assembled from cache:

- Steam short and long description
- 20 most helpful Steam reviews
- PS Store description and star rating (from the batch call)
- Steam tag votes
- Any matching item from the Rogueliker or Choost RSS feeds, matched by name

Model: Workers AI, free allocation (10k neurons/day). One call per game. The system prompt is `docs/TAGGING_PROMPT.md` (to be written from sections 17 to 21 of the ChatGPT schema). Output is the facet JSON in `schema/facets.json` with an `evidence` string per judged facet.

Hybrid rule: if the first-pass score is >= 70, or any hard gate is within 1 point of its threshold, the game lands in Queue. Kevin confirms, edits, or rejects. Confirmed facets get `confirmed_by = 'kevin'` and are never overwritten by a rerun; a rerun on a confirmed game writes to a `proposed` column instead and shows a diff in Queue.

Cost: zero. Roughly 1,500 tokens in, 400 out per game. A 600-game backfill is a few days of the free allocation at a cautious 100 games per day.

### 2.6 Score (client-side)

Pure function `score(facets, weights, gates)` in `src/lib/score.js`. Runs in the browser from the weights in Settings, so moving a slider re-ranks instantly and nothing is refetched. The same function runs in the worker to decide the Queue threshold. One implementation, imported by both.

Rules, from the schema:

- Hard gates zero the score: first-person, manual primary attack, idle game, horde < 4.
- Freeform building: -25. Shallow progression (depth <= 3): -20.
- Weighted sum of the 0-10 facets, weights in `schema/weights.default.json`, summing to 100.
- Quality is computed, not judged: Steam positive %, Steam review count, PSN star rating, PSN rating count, blended with a low-count discount. Under 50 reviews across both stores forces category `wildcard`.

## 3. Hosting

All on Kevin's existing Cloudflare account, all Free tier.

| Piece | Service | Notes |
|---|---|---|
| Static site | The same Worker, assets binding | Vite + React, built to `dist/` on deploy. One deployable, not Pages plus a Worker. |
| API + cron | One Worker, `survivors` | Deployed from the repo by Cloudflare's GitHub integration, not pasted into the dashboard. The LTB worker diverged from its repo copy because nothing deployed it; this project does not repeat that. |
| Database | D1 | Free: 5 GB, 5M row reads/day, 100K writes/day. This site is thousands of rows, not millions. |
| Model | Workers AI | Free allocation, 10k neurons/day. |
| Cron | Worker cron triggers | Free plan allows 3 schedules per Worker. Used: `0 9 * * *` (discover + price refresh), `30 9 * * *` (enrich + match + tag, capped batch), `0 21 * * *` (retry failures). |

Two known Free-tier constraints and how they're handled:

- **10 ms CPU per invocation.** Fetch time doesn't count, but JSON parsing of 20 reviews and the tag scrape does. Each cron tick processes a capped batch (25 games) and re-queues the rest. A backfill of 600 games takes about a month at that pace through the cron alone, so there's also an admin "Run stage now" button that loops the batch in the browser, one call per click cycle, for the initial load.
- **No retries, no failure alerts on cron.** Every stage writes `run_log` (stage, started, finished, ok, count, error). The Queue page shows a red bar if the last tick of any stage failed or if no tick has run in 36 hours.

## 4. D1 tables

```
games            appid PK, name, steam_release, developer, publisher, header_img, status, psn_status, ppid FK, concept_id, first_seen, last_enriched
steam_cache      appid PK, appdetails_json, appreviews_json, tag_votes_json, fetched_at
psn_products     ppid PK, appid FK, concept_id, product_name, edition, store_class, psn_url, is_preorder, is_delisted, base_price, sale_price, plus_price, disc_perc, discounted_until, star_rating, star_count, psp_extra, psp_premium, lowest_seen, refreshed_at
price_snapshots  id PK, ppid FK, observed_at, base_price, sale_price, plus_price
facets           appid PK, version, facets_json, evidence_json, proposed_json, model, tagged_at, confirmed_by, confirmed_at
kevin            appid PK, owned (bool), never (bool), note, updated_at
settings         key PK, value_json           (weights, gates, tag set, region, admin token hash)
run_log          id PK, stage, started_at, finished_at, ok, count, error
api_budget       month PK, used, remaining, reserve, last_header_at
```

## 5. Alerts

None. Decided Sep 9: no Discord, no email. The On sale and Upcoming pages are the alert.

## 6. What is not in v0.1

- Regions other than US (Free plan allows 2; the second slot stays empty until asked for).
- Trophy data (PlatPrices returns it; nothing in the taste schema uses it).
- Xbox, Switch, PC prices.
- Any account system. One admin token, no users.
- Automatic article googling. The corpus is Steam, PS Store, and two RSS feeds.

## 7. Decisions (closed Sep 9)

1. Repo `survivors`, served from the worker's `*.workers.dev` URL. No separate site name.
2. No alerts. Kevin does not use Discord; the site is checked, not pushed.
3. PS4 titles are in when they run on PS5. PlatPrices reports `IsPS4`/`IsPS5`; the Game page shows both.
4. Tag set: Bullet Heaven only to start. The secondary Roguelite rule from 2.1 is not built; instead Settings has an "extra appids" list for stragglers, and Discover accepts any tag Kevin adds later.
5. Queue threshold 70.

## 8. Build order

1. Repo skeleton, D1 schema, worker with `/api/health` and one cron stage (discover). Deploy and prove the cron fires.
2. Steam enrich + PSN match + Queue page. Kevin confirms the first 20 matches by hand; that's the acceptance test for the matcher.
3. Price refresh + budget guard + On sale page.
4. Facet tagging + Browse page + Settings sliders.
5. Upcoming page (trivial once 2 and 3 exist), Game page, Discord if wanted.

Each step ships as its own zip with only the files changed since the last one.

## 9. What v0.2 added (Sep 9)

Kevin's read on v0.1 was that it was bare. Two things were true: nothing was seeded yet, and the pages were database views rather than a tool that answers "what do I buy, and when." v0.2 addresses the second. The generator that produced most of it was category error at portfolio level: the site was architected as a catalog browser, its job is a buying decision. Borrowed domain (Kevin's CQV habit of asking whether a predictor grades itself) produced calibration.

- **Home** is the landing page and a digest keyed to the last visit (stored in the browser): sales ending soon, new sales, new listings, imminent releases, wanted-list drops, best unowned fits.
- **Wanted list.** "Want this" on a game records the price at that moment; Home flags any wanted game now cheaper than when it was added. This is the alert, without an alert channel.
- **Deal verdict** on every price: lowest ever recorded, lowest this site has seen, within N% of the lowest, or has been N% cheaper. Computed in `shared/score.js` `dealVerdict` from PlatPrices' `LowestEverPrice` and the site's own snapshots.
- **Verdicts and calibration.** Owned games can be marked loved / fine / bounced. Settings → Calibration lists them against their score and flags misfires (loved under 60, bounced over 80). This is how Kevin finds out whether the weights are right.
- **Score breakdown** on the Game page: value × weight per facet with a bar, so a number is never a mystery.
- **Compare** page, up to three games, selected from Browse or the Game page.
- **Browse presets** (Best fits, Pure survivors, Authored hub, Prestige or NG+, On sale now, Under $10, Wildcards, Not tagged yet), max price and on-sale filters, sort by discount and review count, CSV and JSON export.
- **Cover images** in every table and on the Game page (Steam header art).
- **Game page**: price sparkline, most helpful Steam reviews, Metacritic and co-op/controller features, PS Store search link for unmatched games, and an admin "attach by ppid" for when the matcher misses.
- **On sale** grouped into lowest-recorded and ending-within-3-days on top of the full list.
- **Upcoming** split into not-on-Steam-yet (sorted by Steam date) and on-Steam-no-PSN.
- **PS Plus tier** (browser setting): games in the Extra or Premium catalog get a mark and a Browse filter.
- Footer shows the catalog counts and the PlatPrices attribution required by the Free plan.

Schema: `migrations/0002_wants.sql` adds `kevin.want`, `want_price`, `want_at`, `verdict`, and `games.matched_at`. New API: `GET /api/home`, `GET /api/admin/calibration`, `POST /api/admin/attach`; `POST /api/admin/kevin` accepts `want` and `verdict`.

Deferred, on purpose: alerts (Kevin does not want a push channel), a second region, trophy data, similarity between games, and any account system.

## 10. v0.3: the look (Sep 9)

Kevin asked for pizzazz with the theme carried through. What the research turned up first: the Fable 5.x UI showcases are hero sections, GLSL shaders, and Three.js scenes, built for a screenshot; the reviewers who tested it for real product screens found it tends to optimize for the dramatic frame over how the page behaves, and that grounded references beat vibes. The gaming dashboards on Dribbble are neon-on-black with glass panels, and the current trend is "liquid glass." None of that is a phone tool a single person checks before buying a game. So the overhaul borrows the game's own vernacular instead.

Tokens (`src/styles.css`):

| Name | Hex | Role |
|---|---|---|
| night | #12101a | background, purple-black like the run screen, never flat #111 |
| stone | #1d1a28 | panels |
| wall | #2c2740 | borders, rules, empty XP track |
| bone | #e6e0cf | body text |
| ash | #9b95ad | secondary text |
| gold | #f5c542 | score, the player, primary button, headings |
| gem | #4fc3ff | XP fill, links, good tier |
| blood | #d9463e | warnings, "has been cheaper" |
| moss | #6fd08c | sale prices |

Type: Silkscreen (pixel face) for headings, nav, level numbers, buttons, table headers. IBM Plex Sans for everything read. Two families, clearly distinct.

The one signature: the XP bar. The header carries a thin bar showing the share of tracked games that are on the PS Store. Every score in the site renders as an XP bar with the number set in the pixel face (`src/components/XpBar.jsx`), gold at 85+, gem-blue at 70+, dimmer below. The Home hero is a canvas horde (`src/components/Horde.jsx`): pixel bats and skeletons drifting toward a gold player square with a whip arc, blue gems pulsing in the field. It stops still under `prefers-reduced-motion` and is the only unprompted motion on the site.

Deliberately not used: gradients as decoration, rounded corners, glass blur, card shadows, all-caps labels, middle-dot meta strings. Buttons are square. The background has a faint pixel-grid dot pattern, one repeating radial dot, which is the closest the site comes to texture.

Copy: "Loading the run" is the only themed string. Everything else stays plain speech.

## 11. v0.4: neat vs annoying (Sep 10)

The question asked before this pass: what does a person checking this on a phone before buying a game find neat, and what do they find annoying? The complaint that shows up most for the incumbents (IsThereAnyDeal, PS Deals, and the like) is stale state: expired deals still listed, duplicate or overlapping editions, prices that lag. The praise is for honest history, a clear "buy or wait" signal, and alerts that fire only when they should.

Robustness, worker side:
- Every upstream fetch has a timeout (Steam 12 s, PlatPrices 15 s) so one hung request cannot eat a cron tick.
- Each stage has a 40 s time budget and stops taking new items past it. Cron ticks now always finish.
- Steam calls are spaced 250 to 300 ms apart; a 429 or 403 backs off five seconds and is recorded as such.
- Games that fail enrichment five times stop being retried (`games.error_count`, migration 0003). They stay visible under Errors in Queue.
- The model call retries once with a stricter instruction when the first reply is not JSON.
- `refresh` reads PlatPrices' `missing` list and marks those products delisted instead of leaving them on the old price forever.
- Discover throws a named error when Steam returns zero items for every tag, which is the signature of a search-HTML change, rather than logging a quiet zero.

Robustness, data side:
- A sale whose `discounted_until` has passed is not a sale, anywhere, even before tonight's refresh. The API computes it, the On sale view filters on it, the nav badge counts only live sales, and the Game page says "Sale ended, price refreshes tonight."
- `/meta` reports `prices_stale` when the newest refresh is older than 48 h; the site shows a banner.
- `/meta` reports whether the PlatPrices key is set; admins see a banner until it is.

Site side:
- An error boundary around every page: a bad row shows an error and a reload link instead of a blank screen.
- Browse filters and On sale sort persist across navigation and reloads. Coming back from a game page does not reset the list.
- "Since last visit" means the previous sitting, not the previous page load: a visit rolls over after six hours away.
- The horde pauses when the tab is hidden, and a click pauses or resumes it, remembered per device.
- External links open in a new tab.
- Nav badges: live sale count on On sale; matches plus facets waiting on Queue (admin only).
- Sticky header; the nav scrolls sideways on narrow phones instead of wrapping.
- PWA manifest and icons, so the site can sit on the iPhone home screen as an app.


### 11a. v0.4.1 fix (Sep 10)

Discover hit Cloudflare's 50-subrequest-per-invocation limit on the free plan because it walked every page of every tag in one call. It now does 6 pages per invocation, stores a cursor in `settings.discover_cursor`, and resumes on the next click, the ↻ button, or the next cron tick. `discover` with `{reset:true}` starts a sweep over. The ↻ button is enabled for discover now and loops until the sweep reports it swept all tags. A full sweep of ~700 games is a dozen or so ↻ rounds, or it just finishes over a few daily cron ticks on its own.


### 11b. v0.4.2 / v0.4.3 fixes (Sep 10)

- v0.4.2: Discover's cursor code called `setSetting` without importing it. Fixed the import.
- v0.4.3: the 50-subrequest-per-invocation cap on Cloudflare's free plan was tripping Enrich, which makes 3 Steam fetches per game (details, reviews, tag votes); a batch of 25 meant 75 fetches. Enrich is now capped at 12 games per invocation (36 fetches), independent of `BATCH_LIMIT`. The shipped `BATCH_LIMIT` default dropped from 25 to 12 so match and tag also stay clear. Subrequest budget per invocation now: discover 6, enrich 36, match 24, tag 12, refresh ~1 per 25 matched games (revisit if the matched catalog ever exceeds ~1000).


## 12. v0.5: the Runner, and automatic mode (Sep 10)

Kevin's ask: automate the whole thing, no review chores. Two changes.

**The Runner.** A Durable Object (`worker/lib/runner.js`, binding `RUNNER`, SQLite-backed so it is on the free plan). Its alarm fires every 45 seconds, `pickStage` finds the first stage with work in pipeline order (discover cursor mid-sweep, then enrich, then match if the PlatPrices key is set, then tag), it runs one batch, and reschedules itself. When nothing is pending it stops. Each alarm is its own Worker invocation, so each batch gets its own 50-subrequest budget; that is the whole reason it exists. Cron pokes it at every tick, so day to day nothing needs pressing. The Queue page has one "Run everything" button for the first backfill or after a change, and a Stop. A safety cap stops it after 400 batches in one start. If Workers AI's daily allocation is hit during tag, the stage reports it and the Runner leaves tag alone until the next start.

**Review mode.** `settings.review_mode`, default `auto`: model tags stand as written, matches are accepted at 0.7 confidence or better, weaker matches are treated as not on PSN and rechecked weekly. `hybrid` restores the earlier behaviour (queue at the threshold, park matches between 0.5 and 0.9). In either mode any game's facets can be edited from its page and a wrong match fixed with "Attach this listing"; those are corrections, not gates.

Also: errored games retry after an hour instead of a day, and "Retry errored games" on Queue resets them immediately and clears stale error notes.

Deploy note: the Durable Object is created by the deploy itself (the `migrations` block in `wrangler.jsonc`). No D1 change for v0.5.


## 13. v0.6: On Steam tab and PS5 plans (Sep 10)

Kevin's ask: split the already-released Steam games out of Upcoming into their own tab, and show when each will hit PS5 if that is knowable.

For matched games the date is real: PlatPrices' `ReleaseDate`, and `IsPreorder` for the not-yet-out ones. For Steam-only games there is no listing to read, so the source is what the developer has said: the game's Steam news feed (`ISteamNews/GetNewsForApp`, free and keyless, fetched during enrich into `steam_cache.news_json`) plus the store description. A new `plans` stage reads those with a short model prompt (`PLAN_SYSTEM`) into one of six statuses: `announced_date` (with a date), `announced_window` (with the window as written), `announced`, `planned` (consoles mentioned, PlayStation not confirmed), `not_planned` (the developer said so), `unknown` (nothing said). The sentence it came from is stored as evidence. The model is told never to infer; "unknown" is the honest default and shows as "Nothing announced".

Stored on `games` (migration 0004: `ps5_plan`, `ps5_plan_date`, `ps5_plan_window`, `ps5_plan_note`, `ps5_plan_at`). Re-read when a game's news feed is refreshed and the last read is over 30 days old, unless a date is already announced. Hand-settable from the Game page (`POST /api/admin/plan`) for the cases where Kevin knows better than the feed.

Pages: **On Steam** (`/games?view=steamonly`) groups by status in order of usefulness: date, window, announced, planned, nothing announced, not planned, and a trailing "not checked yet" group. **Upcoming** (`view=upcoming`) is now only preorders and games not out anywhere. The PlayStation column appears on both, and the Game page has a PlayStation plans line with the evidence.

Enrich now makes 4 Steam fetches per game (details, reviews, tag votes, news), so its batch cap dropped from 12 to 10 (40 subrequests). The Runner picks `plans` after `tag`.


### 13a. v0.6.1: PS4 counts (Sep 10)

Kevin's reminder: a PS4-only release that plays on PS5 is possible and acceptable. Matched games already carry PlatPrices' `IsPS4`/`IsPS5` and are never filtered by generation. The plans read now records which generation the developer named (`ps5_plan_platform`: ps5, ps4, both, unspecified; migration 0005) and the UI shows "(PS4 version, plays on PS5)" when it was PS4 only. User-facing labels say "PlayStation" or "PS Store" rather than "PS5"; column names keep the `ps5_` prefix to avoid churn.


### 13b. v0.6.2: the AI allocation, and one bad byte (Sep 10)

Two errors from the first real run. (1) Workers AI's free allocation (10,000 neurons a day, resets 00:00 UTC) ran out. The stages now record `settings.ai_capped_until` when they hit it, tag and plans return immediately until then, the Runner skips them and schedules itself to wake at 00:05 UTC to carry on, and Queue says so. Match and plans moved to an 8B model (`AI_MODEL_SMALL`, default `@cf/meta/llama-3.1-8b-instruct-fast`) since those are simple reads; tag keeps the 70B model because that is where the judgment is. (2) Workers AI rejected one request body as invalid JSON. Steam news text can carry a lone surrogate (half an emoji); `ai.js` now scrubs prompt text with `toWellFormed()` before sending. A game whose plans read fails for a non-cap reason is stamped `unknown` so it does not block the stage, and "Retry errored games" un-stamps those and clears the cap flag.


## 14. v0.7: the two paid switches (Sep 10)

Both optional, both behind a single dashboard setting, nothing changes if neither is set.

**`PLAN` variable, `free` (default) or `paid`.** Every batch size and the discover page count derive from it. On Workers Paid the subrequest cap is 1,000 per invocation and CPU is 30 s, so: enrich 150 games per batch (600 fetches), discover 40 pages, default batch 60 for match/tag/plans, Runner ticks every 8 s instead of 45. The 700-game backfill goes from a day of ticks to minutes. Workers AI above the free 10,000 neurons/day bills at $0.011 per 1,000 neurons on Paid, so tag stops stalling at the cap.

**`ANTHROPIC_API_KEY` secret (optional) with `CLAUDE_MODEL` (default `claude-haiku-4-5`).** When set, the tag step calls Claude's Messages API instead of Workers AI; match and plans stay on the 8B Workers AI model. One subrequest per game, so it works on Free too. Claude API errors are reported as `claude <status>` and never mark the Workers AI allocation as capped; a 401/402/403/429 stops the batch with the reason in the note. Haiku 4.5 is $1 per million input and $5 per million output tokens; a tag call is roughly 6K in and 600 out, so around a cent per game, a few dollars for the full backfill, then pennies a month.


## 15. v0.8: scopes, the paid fix, editions, and the fun bundle (Sep 10)

**Paid sizing fix.** `BATCH_LIMIT` now applies only on Free; Paid reads `BATCH_LIMIT_PAID` (default 100), so a stale free-plan value in the dashboard cannot throttle a paid account. Enrich 120 per batch on Paid (5 fetches per game), time budget 150 s per batch, Steam pauses 120 ms, Runner ticks 8 s.

**Scopes.** `all` | `available` (`coming_soon = 0`) | `upcoming` (`coming_soon = 1`). A segmented switch at the top of Queue, remembered per device, sent with Run everything and every stage button. The Runner stores the scope it started with and reports it; pending counts and the progress bar respect it. Newly discovered games (no `coming_soon` yet) are enriched under every scope, then classified.

**Editions trap.** Kevin's catch: "Nordic Ashes: Survivors of Ragnarok" is "Nordic Ashes: Complete Edition" on PSN and the literal search missed it. `nameVariants()` tries the full title, then the part before a colon or dash, then with edition words stripped. The match prompt now treats Complete/Definitive/Ultimate/Deluxe/GOTY/Console editions as the same game when no standard edition exists. A one-time `rematch` sweep re-queues every "not listed" game on the first Runner tick after deploy; the button on Queue does it again any time.

**What a picky fan wants (the research).** What people are actually shipping with Fable 5.x on the web: everything procedural and in code (no image assets), single-file three.js + GLSL scenes, canvas-drawn textures, animations that carry the eye somewhere. The lesson taken for a data site: draw it, don't load it. Everything below is SVG, canvas, or CSS, no assets.

- **Tier list** page: S/A/B/C/D by score, F for gate rejections, cover tiles with the number on hover, owned tiles dimmed, wanted tiles gold. The most genre-native way to see a catalog.
- **Stat wheel** (8-axis radar) on every game page and on Compare, where each game's wheel overlays the first game in red.
- **Roll a pick** on Home: a slot reel over unowned PS Store games scoring 55+, weighted toward higher scores, slows and lands.
- **Playtime**: median hours of the 20 most helpful Steam reviewers, and cost per hour at today's PS price. **Playing now**: Steam concurrent players (keyless), with "quiet" under 5 and "busy" over 500. Both from enrich (migration 0006).
- **The genre by quarter**: a bar chart of tracked games by Steam release date, blue for the share on the PS Store.
- The horde follows the pointer or finger; XP bars fill in on load; "Want this" fires a coin burst.


## 16. v0.9: plans that actually look (Sep 10)

Kevin's read: 0 announcements found across 500 games cannot be right. Agreed. Two failure paths in the news-feed method: Steam refusing the news calls (enrich stored an empty feed, the reader correctly said "nothing"), and the 8B model answering with keys the normaliser did not accept (`status` vs `ps5_status`, capitals), which filed as unknown. `parsePlan()` now accepts the variants, and Queue has a diagnostics panel: plan stats (how many feeds are empty, counts by status and method) and "Read one game live", which runs the reader on one appid and shows the cached news, the console mentions, the raw model text, and what parsed.

The real fix is a second method. With `PLANS_WEB_SEARCH=1` and the Anthropic key, the plans step calls Claude with the Messages API web-search tool (up to 4 searches per game) and asks it to check the developer's site and socials, Steam news, the PlayStation Blog, and press, then answer with a status, the sentence, and the source URL (`ps5_plan_url`, `ps5_plan_method`, migration 0007). A new `listed` status means the web found a PS Store listing the matcher missed; that game is pushed back into the match queue. Cost is a few cents per game, roughly $10 to $15 for the catalog once. Web reads run 25 per batch. "Re-read plans" queues everything not yet read with the current method; dated announcements are never re-read.


### 16a. v0.9.2: the money guard (Sep 10)

The web-search read cost $0.05 to $0.08 a game, not the "few cents" claimed in 16, because each search's results land in the prompt. Re-read plans queued 598 of them and spent Kevin's $20 credit in an afternoon. Three changes:

- **Meter and cap.** `ai.js` records every Claude call's input, output, cached tokens, and search count from the API's `usage` block, prices them (Haiku $1/$5 per M, Sonnet $2/$10, $0.01 per search; overridable with `CLAUDE_PRICE_IN`/`CLAUDE_PRICE_OUT`), and keeps a running monthly total in `settings.claude_spend_YYYY-MM`. `CLAUDE_BUDGET_USD` (default 5) is a hard stop: every Claude call refuses once it is reached, the stage reports it, and the Runner skips web reads. Queue shows the total, the cap, calls, and searches.
- **Web reads are gated.** `plans()` now runs two passes: the free news read for everything unread, then, only when `PLANS_WEB_SEARCH=1`, a web read for games the news read left at unknown/planned that score at least `PLANS_WEB_MIN_SCORE` (60) with at least `PLANS_WEB_MIN_REVIEWS` (50) Steam reviews. Two searches per game, 700 output tokens, 15 per batch. That is roughly a tenth of the catalog.
- **Re-read plans no longer spends.** It only re-queues the free news read; the web candidates are selected inside `plans()` by the thresholds above. Its note says how many would qualify at current thresholds.


## 17. v0.10: hardening (Sep 11)

PlatPrices' reviewer looked at the site before issuing a key and saw internals exposed: the public `/api/meta` returned run logs with error text, the PlatPrices quota counters, the AI model in use, and whether the key was set. Nothing secret, but the wrong picture. Changes: `/api/meta` is now catalog-only; everything operational moved to `/api/admin/meta`. Game detail returns error text and proposed facets only to an authenticated admin. Queue and Settings are unlinked and inert for anonymous visitors, and the client only shows admin state after the Worker has accepted the token. A configured `ADMIN_TOKEN` under 24 characters is refused. Security headers on every response and a CSP on the assets (`public/_headers`), `robots.txt` disallows `/api/`. The full model is in `docs/SECURITY.md`, which is also the answer sent to PlatPrices.


## 18. v0.11: worth bothering with (Sep 11)

Kevin's ask, right after adding the PlatPrices key: don't spend the limited monthly quota, or Claude spend, on games below a score, with a live toggle rather than a variable requiring a push.

This works because tagging never depended on a PSN match; a game's taste score comes from Steam data alone. So the pipeline priority changed to score first, spend second: Discover, Enrich, **Tag**, then **Match** (which now requires `facets.score >= match_min_score`, default 70, or the game is marked "want"), then the paid web plan-search (same threshold, reused rather than a second number to keep in sync). A game below the bar simply waits: once tagged, if it clears the bar later it becomes eligible the next batch.

The threshold lives in `taste.match_min_score` in D1, not an environment variable, so it can be changed from Settings and takes effect on the very next batch, no redeploy. Three quick buttons (70, 60, no minimum) plus a number field. Queue shows how many already-scored games are sitting below the current line, and the progress line notes how many are waiting to be scored before they're even eligible. Existing matches are never undone by raising the threshold; the gate only affects new matches going forward. Wrangler's now-unused `PLANS_WEB_MIN_SCORE` variable was removed.
