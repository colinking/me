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

// Constructing a formatter costs far more than using one; the rebuild
// buckets thousands of hours under the free plan's per-invocation CPU cap.
const formatters = new Map<string, Intl.DateTimeFormat>();
const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "numeric",
      hourCycle: "h23",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
};

// Hour-of-week bucket (0 = Monday .. 6 = Sunday) in the room's timezone.
// SQLite can't do IANA timezone math, so rows store UTC and bucketing
// happens here.
export const bucketFor = (
  date: Date,
  timeZone: string,
): { dow: number; hour: number } => {
  const parts = formatterFor(timeZone).formatToParts(date);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? Number.NaN);
  const dow = WEEKDAY_TO_DOW[weekday];
  if (dow === undefined || Number.isNaN(hour)) {
    throw new Error(`could not compute bucket for timezone ${timeZone}`);
  }
  return { dow, hour };
};

type BucketRow = {
  dow: number;
  hour: number;
  observed_min: number;
  hours: number;
  busy_ms: number;
};

type StatsRow = { ok_polls: number; since: string | null };

// Served straight from the aggregate tables maintained by the sampler (see
// aggregates.ts): at most 168 bucket rows plus one stats row per request,
// however much history has accumulated. Never query polls/usage here.
export const heatmap = async (env: Env): Promise<HeatmapResponse> => {
  const [buckets, stats] = await env.WASH_DB.batch<Record<string, unknown>>([
    env.WASH_DB.prepare(
      `SELECT dow, hour, observed_min, hours, busy_ms FROM buckets
       WHERE observed_min > 0 ORDER BY dow, hour`,
    ),
    env.WASH_DB.prepare("SELECT ok_polls, since FROM stats WHERE id = 1"),
  ]);
  const counters = stats.results[0] as StatsRow | undefined;

  return {
    timezone: env.TIMEZONE,
    generatedAt: new Date().toISOString(),
    polls: counters?.ok_polls ?? 0,
    since: counters?.since ?? null,
    buckets: (buckets.results as BucketRow[]).map((row) => {
      const total = row.observed_min;
      const busy = Math.min(Math.round(row.busy_ms / 60_000), total);
      return {
        dow: row.dow,
        hour: row.hour,
        busy,
        total,
        hours: row.hours,
        utilization: busy / total,
      };
    }),
  };
};
