# wash worker

The canonical wash backend, replacing `pages/api/wash/status.ts`:

- `GET /status` — live machine status, same shape and caching as the Vercel
  route it replaced (`/wash/api/status` rewrites here).
- `GET /heatmap` — P(machine in use) per hour-of-week bucket, per machine
  type, aggregated from samples.
- **cron** (`*/10 * * * *`) — polls the WASH backend and records every
  execution in D1: a `polls` row (with the verbatim upstream body in
  `raw_json`) plus one `usage` row per machine. Failures are recorded
  too. Self-throttles via `MIN_POLL_INTERVAL_SECONDS`.

See `docs/WASH_CONNECT_API.md` (repo root) for upstream quirks; the
stuck-`in_use` correction and friends live in `src/wash.ts`. The API types
shared with the site live in `src/types.ts` (types only, platform-neutral —
`pages/wash.tsx` imports from it).

There is deliberately **no preview environment**: the HTTP surface is
read-only and preview versions don't run crons, so branch previews sharing
the production D1 cannot write to it. All write-path testing happens
locally. Revisit if an HTTP write path is ever added.

## Local development

```sh
npm install
npm run migrate:local          # apply schema to the local SQLite D1
npm run dev                    # wrangler dev on :8787 (real workerd)

curl localhost:8787/status
curl "localhost:8787/__scheduled?cron=*/10+*+*+*+*"   # trigger the sampler
curl localhost:8787/heatmap

# Fake usage history, so /heatmap has data before real samples accumulate:
node scripts/generate-seed.mjs > .wrangler/seed.sql
npx wrangler d1 execute wash --local --file .wrangler/seed.sql

# Inspect the local database (plain SQLite under .wrangler/state):
npx wrangler d1 execute wash --local \
  --command "SELECT * FROM polls ORDER BY id DESC LIMIT 5"
```

The local D1 is keyed by the `database_id` in `wrangler.jsonc` — changing
the id starts from an empty local database (re-run migrations + seed).

To run the site against it: `npm run dev` here, `next dev` at the repo
root; the `/wash/api/:path*` rewrite defaults to `http://localhost:8787`.

`npm test` runs Vitest inside workerd (`@cloudflare/vitest-pool-workers`)
with an isolated, migrated D1 per test and a mocked upstream.

## First deploy (remaining steps)

The D1 database `wash` exists (its id is in `wrangler.jsonc`) but has no
schema yet.

1. `npx wrangler login`
2. `npx wrangler d1 migrations apply wash --remote`
3. `npx wrangler deploy` — verify `https://wash.<account>.workers.dev/status`
   and `/heatmap`, and that cron executions appear
   (`wrangler d1 execute wash --remote --command "SELECT * FROM polls"`).
4. On Vercel, set `WASH_API_ORIGIN` to the worker URL.
   ⚠️ The site now depends on this: do not deploy the site's /wash changes
   before steps 2–4 are done, or the page will have no backend.
5. Optional: connect Workers Builds (dashboard → Worker → Settings → Build,
   root directory `workers/wash`) for deploys on push; use build command
   `npx wrangler d1 migrations apply wash --remote && npx wrangler deploy`
   so schema changes apply with the deploy that needs them.
