import { heatmap } from "./heatmap";
import { type Env, samplePoll } from "./sample";
import {
  DEFAULT_CODE,
  SITE_CODE_PATTERN,
  type StatusResponse,
  cachedLocation,
  fetchMachines,
  parseMachines,
  resolveLocation,
} from "./wash";

export type { Env };

// Public read-only endpoints; CORS is open so the page can hit the worker
// directly (e.g. during local dev) instead of via the Vercel rewrite.
const json = (body: unknown, status: number, cacheControl: string): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": cacheControl,
      "Access-Control-Allow-Origin": "*",
    },
  });

// Don't serve archived polls older than this as a fallback — the page
// would present them as barely-stale ("showing data from X").
const FALLBACK_MAX_AGE_MS = 60 * 60_000;

// When the upstream is down, rebuild a status body from the sampler's
// most recent successful poll (cron, every 10 minutes). Only the default
// site is sampled, so other codes find no rows and still get a 502.
const statusFromLastPoll = async (
  env: Env,
  code: string,
): Promise<StatusResponse | null> => {
  const row = await env.WASH_DB.prepare(
    `SELECT polled_at, raw_json FROM polls
     WHERE ok = 1 AND code = ? ORDER BY id DESC LIMIT 1`,
  )
    .bind(code)
    .first<{ polled_at: string; raw_json: string | null }>();
  if (!row?.raw_json) {
    return null;
  }
  if (Date.now() - Date.parse(row.polled_at) > FALLBACK_MAX_AGE_MS) {
    return null;
  }
  const machines = parseMachines(
    JSON.parse(row.raw_json) as Record<string, unknown>,
    new Date(),
  );
  return {
    location: {
      code,
      name: cachedLocation(code)?.name ?? null,
      deviceType: cachedLocation(code)?.deviceType ?? null,
    },
    machines: machines.map(({ machine }) => machine),
    fetchedAt: row.polled_at,
    stale: true,
  };
};

// Same response shape and caching behavior as the Vercel route this
// replaces (pages/api/wash/status.ts); /wash/api/status rewrites here.
const handleStatus = async (url: URL, env: Env): Promise<Response> => {
  const raw = url.searchParams.get("code") ?? DEFAULT_CODE;
  if (!SITE_CODE_PATTERN.test(raw)) {
    return json({ error: "invalid site code" }, 400, "no-store");
  }
  // Codes are case-insensitive; normalize so the location cache doesn't
  // fragment by case and upstream always sees a consistent srcode.
  const code = raw.toLowerCase();
  try {
    const { uln, name, deviceType } = await resolveLocation(code);
    const { machines } = await fetchMachines(uln);
    const body: StatusResponse = {
      location: { code, name, deviceType },
      machines: machines.map(({ machine }) => machine),
      fetchedAt: new Date().toISOString(),
    };
    return json(body, 200, "public, s-maxage=30, stale-while-revalidate=60");
  } catch (err) {
    const fallback = await statusFromLastPoll(env, code).catch(() => null);
    if (fallback) {
      // no-store: a shared cache must not serve stale bodies once the
      // upstream recovers.
      return json(fallback, 200, "no-store");
    }
    return json(
      { error: err instanceof Error ? err.message : "upstream error" },
      502,
      "no-store",
    );
  }
};

const handleHeatmap = async (env: Env): Promise<Response> => {
  try {
    const body = await heatmap(env);
    // Same cache window as /status so new cron samples show up within a
    // minute or two of landing. The query only touches our own D1 — the
    // WASH upstream is never involved — so the short window is cheap.
    return json(body, 200, "public, s-maxage=60, stale-while-revalidate=600");
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "query error" },
      500,
      "no-store",
    );
  }
};

export default {
  async fetch(req, env, _ctx): Promise<Response> {
    if (req.method !== "GET") {
      return new Response("method not allowed", {
        status: 405,
        headers: { Allow: "GET" },
      });
    }
    const url = new URL(req.url);
    switch (url.pathname) {
      case "/status":
        return handleStatus(url, env);
      case "/heatmap":
        return handleHeatmap(env);
      default:
        return json({ error: "not found" }, 404, "no-store");
    }
  },

  async scheduled(controller, env): Promise<void> {
    const outcome = await samplePoll(env, controller.cron || "manual");
    // Worker logs (observability) are the execution trail for cron runs;
    // the polls table is the durable one.
    console.log("sample", JSON.stringify(outcome));
  },
} satisfies ExportedHandler<Env>;
