# Security model

How the site handles secrets and who can do what. Written Sep 11 2026 after PlatPrices asked how their key would be protected.

## Secrets

- Every credential (`PLATPRICES_KEY`, `ANTHROPIC_API_KEY`, `ADMIN_TOKEN`) is a Cloudflare Worker **secret**: encrypted at rest, write-only in the dashboard, never in the repository, never in a build log, never sent to a browser.
- The repository contains no credentials. `wrangler.jsonc` carries only public configuration (a D1 database id, which is not a secret).
- Third-party APIs are called **only from the Worker**. The browser talks to the Worker's own `/api/*` routes and nothing else; the `connect-src 'self'` policy in the CSP enforces that in the client.
- PlatPrices responses are cached in D1 and served to the public as prices with attribution. The key, the request quota counters, and the API's status output are visible only behind admin auth.

## Public surface

Public routes return catalog data only: game facts, prices, scores, the taste weights used to compute them, and price freshness. No run logs, no error text, no quota counters, no model names, no indication of which credentials are configured.

## Admin surface

- All write routes and all operational reads live under `/api/admin/*` and require `Authorization: Bearer <ADMIN_TOKEN>`.
- The comparison is constant-time. A configured token shorter than 24 characters is refused outright, so a weak token cannot be used.
- The admin pages (Queue, Settings) are not linked for anonymous visitors and render nothing operational without an accepted token. The token is held in the owner's browser storage only.
- Deploys are from a single GitHub repository through Cloudflare's Git integration; there is no dashboard-edited code.

## Transport and headers

HTTPS only (workers.dev). Every response carries `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, and API responses are `Cache-Control: no-store`. The site ships a Content-Security-Policy: scripts from self only, connections to self only, images limited to Steam's and PlatPrices' CDNs, no framing. `/api/` is disallowed in `robots.txt`.

## Quota protection for PlatPrices

The Worker mirrors PlatPrices' rate-limit headers into D1 and stops spending requests when the month's remaining count would fall below a reserve (150). Batch endpoints are used (25 ids per call), prices are refreshed once a day, and search calls happen only when a new game appears. A single Worker instance makes all calls; no client ever calls PlatPrices.
