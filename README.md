# survivors

Tracks survivors-like games (Steam's Bullet Heaven tag) and follows them onto the US PlayStation Store: releases, preorders, sales, and a taste score against Kevin's profile.

Docs: `docs/ARCHITECTURE.md` (how it works), `docs/TASTE_SCHEMA.md` (what the score means), `docs/DEPLOY.md` (first-time setup).

Stack: one Cloudflare Worker (API + cron + static assets), D1, Workers AI, Vite + React front end. Everything on Cloudflare's free tier plus a free PlatPrices API key.

```
npm install
npm test          # scoring, parsers, schema drift
npm run build     # builds dist/ for the assets binding
npm run deploy    # build + wrangler deploy (after docs/DEPLOY.md)
```
