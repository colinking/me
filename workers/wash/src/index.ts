import { heatmap } from "./heatmap";
import { type Env, samplePoll } from "./sample";
import {
  DEFAULT_CODE,
  SITE_CODE_PATTERN,
  type StatusResponse,
  fetchMachines,
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

// Same response shape and caching behavior as the Vercel route this
// replaces (pages/api/wash/status.ts); /wash/api/status rewrites here.
const handleStatus = async (url: URL): Promise<Response> => {
  const code = url.searchParams.get("code") ?? DEFAULT_CODE;
  if (!SITE_CODE_PATTERN.test(code)) {
    return json({ error: "invalid site code" }, 400, "no-store");
  }
  try {
    const { uln, name } = await resolveLocation(code);
    const { machines } = await fetchMachines(uln);
    const body: StatusResponse = {
      location: { code, name },
      machines: machines.map(({ machine }) => machine),
      fetchedAt: new Date().toISOString(),
    };
    return json(body, 200, "public, s-maxage=30, stale-while-revalidate=60");
  } catch (err) {
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
    return json(body, 200, "public, s-maxage=3600, stale-while-revalidate=600");
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
        return handleStatus(url);
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
