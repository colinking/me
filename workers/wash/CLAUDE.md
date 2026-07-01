# CLAUDE.md — Wash Laundry worker

Cloudflare Worker that backs the `/wash` page. A cron (`*/10 * * * *`) polls the
WASH Connect upstream and records every execution — success **or** failure — to a
D1 database. See `README.md` (this dir) for architecture and
`docs/WASH_CONNECT_API.md` (repo root) for upstream quirks.

## Reviewing logs, metrics & errors

The **`polls` table in D1 is the durable, ground-truth trail** of every cron
execution, including failures (`ok = 0`, message in `error`). Query it directly —
no need to be logged into the dashboard.

- Worker script: `wash`
- D1 `database_name`: `wash`
- D1 `database_id`: `50267718-3073-4eaf-a705-f64ae8545cb4` (in `wrangler.jsonc`)

Query via the Cloudflare MCP `d1_database_query` tool (preferred — no login), or
`npx wrangler d1 execute wash --remote --command "<SQL>"` from this dir.

**Health summary (failures, latency, freshness):**
```sql
SELECT COUNT(*) total, SUM(ok) ok, SUM(1-ok) failed,
       MAX(polled_at) last_poll, ROUND(AVG(CASE WHEN ok=1 THEN upstream_ms END)) avg_ms
FROM polls;
```
Cadence is one poll per 10 min, so expect ~144/day. `last_poll` far from now =
cron stalled. `error` on failed rows tells you what broke.

**Recent failures:**
```sql
SELECT polled_at, code, error, upstream_ms FROM polls WHERE ok=0 ORDER BY id DESC LIMIT 20;
```

**Per-day failure/slow counts:**
```sql
SELECT date(polled_at) day, COUNT(*) polls, SUM(1-ok) failures
FROM polls GROUP BY day ORDER BY day DESC LIMIT 14;
```

**Interpreting errors — two distinct failure classes:**
- **WASH upstream failure** (fetch/parse errors from `src/wash.ts`) → the
  laundry API is actually down or changed shape. `upstream_ms` reflects real
  fetch latency. `/status` falls back to the last good poll (<1h old).
- **`D1_ERROR: ... storage operation exceeded timeout ...`** → Cloudflare D1
  infra hiccup on the *write*, not a WASH problem. `upstream_ms` shows ~30s (the
  D1 timeout, not the fetch). These are isolated and self-heal on the next 10-min
  cron (failed polls don't count toward self-throttling, so the next trigger
  retries). No action needed unless they cluster.

Because failed-poll `upstream_ms` is inflated by the D1 timeout, always scope
latency stats to `ok=1` (as the health query above does).

**Worker console logs / invocation metrics** (observability is enabled in
`wrangler.jsonc`): each cron logs `sample {...outcome}`. Available in the
Cloudflare dashboard → Workers → `wash` → Logs/Observability, or via the
observability MCP. The D1 `polls` table is the durable record; logs are the
transient execution trail.
