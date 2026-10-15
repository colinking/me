import { aggregateWrites, ensureAggregates } from "./aggregates";
import { DEFAULT_CODE, fetchMachines, resolveLocation } from "./wash";

export interface Env {
  WASH_DB: D1Database;
  TIMEZONE: string;
  MIN_POLL_INTERVAL_SECONDS: string;
}

export type SampleOutcome =
  | { kind: "sampled"; pollId: number; machines: number }
  | { kind: "skipped"; reason: string }
  | { kind: "failed"; pollId: number; error: string };

// One sampler execution: poll upstream, record the poll (success or
// failure) plus one row per machine. Every execution leaves a trace.
export const samplePoll = async (
  env: Env,
  source: string,
): Promise<SampleOutcome> => {
  const outcome = await poll(env, source);
  // Fold history into the heatmap aggregates once after deploy, and after a
  // manual reset (stats.built = 0). Runs after the raw record is written so
  // a failing rebuild never blocks sampling; it backs off its own retries.
  try {
    if (await ensureAggregates(env)) {
      console.log("aggregates rebuilt");
    }
  } catch (err) {
    console.error(
      "aggregate rebuild failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
  return outcome;
};

const poll = async (env: Env, source: string): Promise<SampleOutcome> => {
  const now = new Date();
  const minIntervalMs = Number(env.MIN_POLL_INTERVAL_SECONDS) * 1_000;

  // Self-throttle so overlapping triggers or retries can't double-count.
  // Failed polls don't count — we want the next trigger to retry.
  if (minIntervalMs > 0) {
    const last = await env.WASH_DB.prepare(
      "SELECT polled_at FROM polls WHERE ok = 1 ORDER BY id DESC LIMIT 1",
    ).first<{ polled_at: string }>();
    if (last) {
      const elapsedMs = now.getTime() - Date.parse(last.polled_at);
      if (elapsedMs < minIntervalMs) {
        return {
          kind: "skipped",
          reason: `last poll ${Math.round(elapsedMs / 1000)}s ago`,
        };
      }
    }
  }

  const startedAt = Date.now();
  try {
    const { uln } = await resolveLocation(DEFAULT_CODE);
    const { machines, rawBody } = await fetchMachines(uln);
    const upstreamMs = Date.now() - startedAt;

    const inserted = await env.WASH_DB.prepare(
      `INSERT INTO polls (polled_at, source, code, ok, upstream_ms, raw_json)
       VALUES (?, ?, ?, 1, ?, ?)`,
    )
      .bind(
        now.toISOString(),
        source,
        DEFAULT_CODE,
        upstreamMs,
        JSON.stringify(rawBody),
      )
      .run();
    const pollId = inserted.meta.last_row_id;

    // The usage rows and the heatmap aggregates land in one batch, so the
    // raw record and the derived tables can't disagree.
    const insert = env.WASH_DB.prepare(
      `INSERT INTO usage
         (poll_id, machine_number, type, status, derived_status,
          start_time, ends_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    await env.WASH_DB.batch([
      ...machines.map(({ machine, raw }) =>
        insert.bind(
          pollId,
          machine.number,
          machine.type,
          raw.status ?? "unknown",
          machine.status,
          raw.start_time ?? null,
          machine.endsAt,
        ),
      ),
      ...(await aggregateWrites(env, now.toISOString(), machines)),
    ]);
    return { kind: "sampled", pollId, machines: machines.length };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const poll = await env.WASH_DB.prepare(
      `INSERT INTO polls (polled_at, source, code, ok, error, upstream_ms)
       VALUES (?, ?, ?, 0, ?, ?)`,
    )
      .bind(
        now.toISOString(),
        source,
        DEFAULT_CODE,
        error,
        Date.now() - startedAt,
      )
      .run();
    return { kind: "failed", pollId: poll.meta.last_row_id, error };
  }
};
