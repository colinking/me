import type { Env } from "./sample";
import type { HeatmapResponse } from "./types";

const WEEKDAY_TO_DOW: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

// Hour-of-week bucket (0 = Monday .. 6 = Sunday) in the room's timezone,
// computed at read time — SQLite can't do IANA timezone math, so rows
// store UTC timestamps and bucketing happens here.
export const bucketFor = (
  date: Date,
  timeZone: string,
): { dow: number; hour: number } => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? Number.NaN);
  const dow = WEEKDAY_TO_DOW[weekday];
  if (dow === undefined || Number.isNaN(hour)) {
    throw new Error(`could not compute bucket for timezone ${timeZone}`);
  }
  return { dow, hour };
};

// Time-weighted utilization per hour-of-week bucket: a cycle running 12:40
// to 1:20 contributes 20 busy-minutes to the 12-1 bucket and 20 to the 1-2
// bucket, regardless of when polls landed. Cycles are reconstructed from
// the start_time/ends_at recorded on samples — this also counts cycles
// that ran entirely between polls (they surface via the changed start_time
// on the next poll of an available machine).
//
// Numerator: busy minutes from cycle intervals, split at hour boundaries.
// Denominator: observed machine-minutes — each calendar hour in which a
// machine was polled (and not out_of_service) credits 60 minutes to that
// hour's bucket. Buckets with no observed time are omitted. Cycles in
// hours we never observed therefore drop out, and a coverage gap can at
// worst clamp a bucket to 100%.
//
// `should_be_done` is consistent by construction: a cycle's busy interval
// ends at ends_at, never later. out_of_service samples contribute neither
// coverage nor cycles — a broken machine says nothing about demand.

// Defensive cap: upstream time_remaining glitches shouldn't let one bogus
// cycle smear hours of phantom usage.
const MAX_CYCLE_MS = 6 * 3600_000;

const HOUR_MS = 3600_000;

type CycleRow = { machine_number: string; start_time: string; ends_at: string };
type CoverageRow = { machine_number: string; utc_hour: string; n: number };

// Cycles dedupe on (machine, start_time); MAX(ends_at) wins so a cycle
// extended mid-run (unverified upstream behavior) counts its longest
// observed interval.
const CYCLES_SQL = `
  SELECT machine_number, start_time, MAX(ends_at) AS ends_at
  FROM usage
  WHERE start_time IS NOT NULL AND ends_at IS NOT NULL
    AND derived_status != 'out_of_service'
  GROUP BY machine_number, start_time
`;

const COVERAGE_SQL = `
  SELECT u.machine_number, substr(p.polled_at, 1, 13) AS utc_hour, COUNT(*) AS n
  FROM usage u
  JOIN polls p ON p.id = u.poll_id
  WHERE u.derived_status != 'out_of_service'
  GROUP BY u.machine_number, utc_hour
`;

export const heatmap = async (env: Env): Promise<HeatmapResponse> => {
  const [cycles, coverage, polls] = await Promise.all([
    env.WASH_DB.prepare(CYCLES_SQL).all<CycleRow>(),
    env.WASH_DB.prepare(COVERAGE_SQL).all<CoverageRow>(),
    env.WASH_DB.prepare(
      "SELECT COUNT(*) AS n, MIN(polled_at) AS since FROM polls WHERE ok = 1",
    ).first<{ n: number; since: string | null }>(),
  ]);

  // Map a UTC hour ("2026-06-12T04") to its local hour-of-week bucket,
  // using the hour's midpoint so DST boundaries can't straddle.
  const bucketCache = new Map<string, string>();
  const bucketKeyFor = (utcHour: string): string => {
    let key = bucketCache.get(utcHour);
    if (key === undefined) {
      const { dow, hour } = bucketFor(
        new Date(`${utcHour}:30:00.000Z`),
        env.TIMEZONE,
      );
      key = `${dow}-${hour}`;
      bucketCache.set(utcHour, key);
    }
    return key;
  };

  // Observed machine-minutes per bucket.
  const observedMin = new Map<string, number>();
  for (const row of coverage.results ?? []) {
    const key = bucketKeyFor(row.utc_hour);
    observedMin.set(key, (observedMin.get(key) ?? 0) + 60);
  }

  // Busy milliseconds per bucket, from cycle intervals split at UTC hour
  // boundaries. In-flight cycles only count time elapsed so far; the
  // remainder accrues once later polls confirm it.
  const nowMs = Date.now();
  const busyMs = new Map<string, number>();
  for (const row of cycles.results ?? []) {
    const startMs = Date.parse(row.start_time);
    const endMs = Math.min(Date.parse(row.ends_at), nowMs);
    if (
      Number.isNaN(startMs) ||
      Number.isNaN(endMs) ||
      endMs <= startMs ||
      endMs - startMs > MAX_CYCLE_MS
    ) {
      continue;
    }
    for (let t = startMs; t < endMs; ) {
      const segmentEnd = Math.min(endMs, Math.floor(t / HOUR_MS + 1) * HOUR_MS);
      const utcHour = new Date(t).toISOString().slice(0, 13);
      const key = bucketKeyFor(utcHour);
      busyMs.set(key, (busyMs.get(key) ?? 0) + (segmentEnd - t));
      t = segmentEnd;
    }
  }

  return {
    timezone: env.TIMEZONE,
    generatedAt: new Date().toISOString(),
    polls: polls?.n ?? 0,
    since: polls?.since ?? null,
    buckets: [...observedMin.entries()]
      .map(([key, total]) => {
        const [dow, hour] = key.split("-").map(Number);
        const busy = Math.min(
          Math.round((busyMs.get(key) ?? 0) / 60_000),
          total,
        );
        return { dow, hour, busy, total, utilization: busy / total };
      })
      .sort((a, b) => a.dow - b.dow || a.hour - b.hour),
  };
};
