// Incremental aggregates behind /heatmap.
//
// polls/usage are the raw record and grow forever, so anything that scans
// them costs O(history) D1 row reads per call — which is what exhausted the
// free tier's daily read budget. The sampler instead folds each poll into
// the bounded tables from migrations/0002_aggregates.sql (a handful of reads
// and writes per poll), and /heatmap reads the hour-of-week buckets directly.
//
// Semantics match the original full-scan queries: coverage is 60 minutes per
// (machine, UTC hour) seen at least once outside out_of_service; busy time is
// the overlap of each cycle's [start_time, furthest ends_at) with the hour;
// observations longer than MAX_CYCLE_MS are ignored as garbage.
//
// The tables are derived, so they can always be rebuilt from history: set
// stats.built = 0 and the next sampler run calls rebuildAggregates.

import { bucketFor } from "./heatmap";
import type { Env } from "./sample";
import type { ObservedMachine } from "./wash";

const MAX_CYCLE_MS = 6 * 3600_000;
const HOUR_MS = 3600_000;
const OUT_OF_SERVICE = "out_of_service";
const BATCH_SIZE = 100;
// A rebuild that keeps failing is retried at most this often: each attempt
// is the one O(history) scan, and 144 of them a day would be its own outage.
const REBUILD_BACKOFF_MS = 6 * 3600_000;

type Observation = {
  number: string;
  startTime?: string | null;
  endsAt?: string | null;
};

type Cycle = {
  number: string;
  startTime: string;
  endsAt: string;
  startMs: number;
  endMs: number;
};

/** Validate one reported cycle, or null when it is unusable. */
const parseCycle = ({ number, startTime, endsAt }: Observation): Cycle | null => {
  if (!startTime || !endsAt) {
    return null;
  }
  const startMs = Date.parse(startTime);
  const endMs = Date.parse(endsAt);
  if (
    Number.isNaN(startMs) ||
    Number.isNaN(endMs) ||
    endMs <= startMs ||
    endMs - startMs > MAX_CYCLE_MS
  ) {
    return null;
  }
  return { number, startTime, endsAt, startMs, endMs };
};

/** One entry per cycle, keeping the furthest valid end. */
const collapseCycles = (rows: Observation[]): Cycle[] => {
  const cycles = new Map<string, Cycle>();
  for (const row of rows) {
    const cycle = parseCycle(row);
    if (!cycle) {
      continue;
    }
    const key = `${cycle.number}\n${cycle.startTime}`;
    const prev = cycles.get(key);
    if (!prev || prev.endMs < cycle.endMs) {
      cycles.set(key, cycle);
    }
  }
  return [...cycles.values()];
};

const utcHourOf = (ms: number): string =>
  new Date(ms).toISOString().slice(0, 13);

const UPSERT_BUCKET = `
  INSERT INTO buckets (dow, hour, observed_min, hours, busy_ms)
  VALUES (?1, ?2, ?3, ?4, ?5)
  ON CONFLICT (dow, hour) DO UPDATE SET
    observed_min = observed_min + excluded.observed_min,
    hours = hours + excluded.hours,
    busy_ms = busy_ms + excluded.busy_ms
`;

const UPSERT_CYCLE = `
  INSERT INTO cycles (machine_number, start_time, ends_at)
  VALUES (?1, ?2, ?3)
  ON CONFLICT (machine_number, start_time) DO UPDATE SET
    ends_at = MAX(ends_at, excluded.ends_at)
`;

const UPSERT_STATS = `
  INSERT INTO stats (id, ok_polls, since) VALUES (1, 1, ?1)
  ON CONFLICT (id) DO UPDATE SET
    ok_polls = ok_polls + 1,
    since = CASE
      WHEN since IS NULL OR excluded.since < since THEN excluded.since
      ELSE since
    END
`;

type BucketDelta = {
  dow: number;
  hour: number;
  observedMin: number;
  hours: number;
  busyMs: number;
};

/** Per-bucket increments for one write batch. */
class BucketDeltas {
  private readonly byKey = new Map<string, BucketDelta>();
  private readonly byUtcHour = new Map<string, BucketDelta>();

  constructor(private readonly timeZone: string) {}

  private at(utcHour: string): BucketDelta {
    let delta = this.byUtcHour.get(utcHour);
    if (!delta) {
      // The hour's midpoint, so DST boundaries can't straddle buckets.
      const { dow, hour } = bucketFor(
        new Date(`${utcHour}:30:00.000Z`),
        this.timeZone,
      );
      const key = `${dow}-${hour}`;
      delta = this.byKey.get(key);
      if (!delta) {
        delta = { dow, hour, observedMin: 0, hours: 0, busyMs: 0 };
        this.byKey.set(key, delta);
      }
      this.byUtcHour.set(utcHour, delta);
    }
    return delta;
  }

  /** `machines` first seen in `utcHour`; `newHour` when the hour itself is. */
  observe(utcHour: string, machines: number, newHour: boolean): void {
    const delta = this.at(utcHour);
    delta.observedMin += 60 * machines;
    if (newHour) {
      delta.hours += 1;
    }
  }

  /** Busy time for [startMs, endMs), split across UTC hours. */
  busy(startMs: number, endMs: number): void {
    for (let t = startMs; t < endMs; ) {
      const segmentEnd = Math.min(endMs, Math.floor(t / HOUR_MS + 1) * HOUR_MS);
      this.at(utcHourOf(t)).busyMs += segmentEnd - t;
      t = segmentEnd;
    }
  }

  statements(env: Env): D1PreparedStatement[] {
    const upsert = env.WASH_DB.prepare(UPSERT_BUCKET);
    return [...this.byKey.values()]
      .filter((d) => d.observedMin > 0 || d.hours > 0 || d.busyMs > 0)
      .map((d) => upsert.bind(d.dow, d.hour, d.observedMin, d.hours, d.busyMs));
  }
}

/**
 * The statements that fold one successful poll into the aggregates. The
 * round trip here only reads (what has this hour/machine/cycle already
 * contributed?); the caller batches the returned writes together with the
 * poll's usage rows, so the raw record and the aggregates move atomically.
 */
export const aggregateWrites = async (
  env: Env,
  polledAt: string,
  machines: ObservedMachine[],
): Promise<D1PreparedStatement[]> => {
  const db = env.WASH_DB;
  const utcHour = polledAt.slice(0, 13);
  const active = machines.filter(
    ({ machine }) => machine.status !== OUT_OF_SERVICE,
  );
  const machineNumbers = [...new Set(active.map(({ machine }) => machine.number))];
  const cycles = collapseCycles(
    active.map(({ machine, raw }) => ({
      number: machine.number,
      startTime: raw.start_time,
      endsAt: machine.endsAt,
    })),
  );

  const machineSeen = db.prepare(
    "SELECT 1 AS seen FROM machine_hours WHERE machine_number = ?1 AND utc_hour = ?2",
  );
  const cycleEnd = db.prepare(
    "SELECT ends_at FROM cycles WHERE machine_number = ?1 AND start_time = ?2",
  );
  const probes = await db.batch<{ seen?: number; ends_at?: string }>([
    db.prepare("SELECT 1 AS seen FROM observed_hours WHERE utc_hour = ?1").bind(utcHour),
    ...machineNumbers.map((number) => machineSeen.bind(number, utcHour)),
    ...cycles.map((c) => cycleEnd.bind(c.number, c.startTime)),
  ]);
  const hourSeen = probes[0].results.length > 0;
  const machineResults = probes.slice(1, 1 + machineNumbers.length);
  const cycleResults = probes.slice(1 + machineNumbers.length);

  const deltas = new BucketDeltas(env.TIMEZONE);
  const writes: D1PreparedStatement[] = [db.prepare(UPSERT_STATS).bind(polledAt)];

  if (machineNumbers.length > 0) {
    if (!hourSeen) {
      writes.push(
        db.prepare("INSERT INTO observed_hours (utc_hour) VALUES (?1)").bind(utcHour),
      );
    }
    const insertMachineHour = db.prepare(
      "INSERT INTO machine_hours (machine_number, utc_hour) VALUES (?1, ?2)",
    );
    const newMachines = machineNumbers.filter(
      (_, i) => machineResults[i].results.length === 0,
    );
    for (const number of newMachines) {
      writes.push(insertMachineHour.bind(number, utcHour));
    }
    deltas.observe(utcHour, newMachines.length, !hourSeen);
  }

  const upsertCycle = db.prepare(UPSERT_CYCLE);
  cycles.forEach((c, j) => {
    const known = cycleResults[j].results[0]?.ends_at;
    const knownEndMs = known ? Date.parse(known) : Number.NaN;
    if (knownEndMs >= c.endMs) {
      return;
    }
    // Only the extension beyond what was already counted is new busy time.
    deltas.busy(Number.isNaN(knownEndMs) ? c.startMs : knownEndMs, c.endMs);
    writes.push(upsertCycle.bind(c.number, c.startTime, c.endsAt));
  });
  writes.push(...deltas.statements(env));
  return writes;
};

/**
 * Rebuild the aggregates from history unless they are already built. Takes a
 * lease in `stats` first, so overlapping runs rebuild once and a rebuild that
 * keeps failing is retried only every REBUILD_BACKOFF_MS. Returns whether a
 * rebuild ran.
 */
export const ensureAggregates = async (env: Env): Promise<boolean> => {
  const db = env.WASH_DB;
  const state = await db
    .prepare("SELECT built FROM stats WHERE id = 1")
    .first<{ built: number }>();
  if (state?.built) {
    return false;
  }
  const now = Date.now();
  const [, lease] = await db.batch([
    db.prepare("INSERT OR IGNORE INTO stats (id, ok_polls, since) VALUES (1, 0, NULL)"),
    db
      .prepare(
        `UPDATE stats SET rebuild_attempted_at = ?1
         WHERE id = 1 AND built = 0
           AND (rebuild_attempted_at IS NULL OR rebuild_attempted_at < ?2)`,
      )
      .bind(
        new Date(now).toISOString(),
        new Date(now - REBUILD_BACKOFF_MS).toISOString(),
      ),
  ]);
  if (lease.meta.changes === 0) {
    return false;
  }
  await rebuildAggregates(env);
  return true;
};

/**
 * Recompute every aggregate table from polls/usage. This is the one
 * O(history) scan in the worker; it runs once after the migration and
 * whenever stats.built is reset to 0. /heatmap keeps serving the previous
 * buckets until the final batch swaps them.
 */
export const rebuildAggregates = async (env: Env): Promise<void> => {
  const db = env.WASH_DB;

  // 1. Reset the dedup sets and derive what plain SQL can.
  await db.batch([
    db.prepare("DELETE FROM machine_hours"),
    db.prepare("DELETE FROM observed_hours"),
    db.prepare("DELETE FROM cycles"),
    db.prepare(`
      INSERT INTO machine_hours (machine_number, utc_hour)
      SELECT DISTINCT u.machine_number, substr(p.polled_at, 1, 13)
      FROM usage u
      JOIN polls p ON p.id = u.poll_id
      WHERE u.derived_status != 'out_of_service'
    `),
    db.prepare(
      "INSERT INTO observed_hours (utc_hour) SELECT DISTINCT utc_hour FROM machine_hours",
    ),
  ]);

  // 2. Cycles: interval validation lives in JS, so collapse to distinct
  //    observations in SQL and pick each cycle's furthest valid end here.
  const observed = await db
    .prepare(`
      SELECT machine_number, start_time, ends_at
      FROM usage
      WHERE start_time IS NOT NULL AND ends_at IS NOT NULL
        AND derived_status != 'out_of_service'
      GROUP BY machine_number, start_time, ends_at
    `)
    .all<{ machine_number: string; start_time: string; ends_at: string }>();
  const cycles = collapseCycles(
    observed.results.map((row) => ({
      number: row.machine_number,
      startTime: row.start_time,
      endsAt: row.ends_at,
    })),
  );
  const upsertCycle = db.prepare(UPSERT_CYCLE);
  for (let i = 0; i < cycles.length; i += BATCH_SIZE) {
    await db.batch(
      cycles
        .slice(i, i + BATCH_SIZE)
        .map((c) => upsertCycle.bind(c.number, c.startTime, c.endsAt)),
    );
  }

  // 3. Buckets from the aggregates, swapped in atomically together with the
  //    counters; built = 1 marks completion and releases the lease.
  const hours = await db
    .prepare(
      "SELECT utc_hour, COUNT(*) AS machines FROM machine_hours GROUP BY utc_hour",
    )
    .all<{ utc_hour: string; machines: number }>();
  const deltas = new BucketDeltas(env.TIMEZONE);
  for (const row of hours.results) {
    deltas.observe(row.utc_hour, row.machines, true);
  }
  for (const c of cycles) {
    deltas.busy(c.startMs, c.endMs);
  }
  await db.batch([
    db.prepare("DELETE FROM buckets"),
    ...deltas.statements(env),
    db.prepare(`
      INSERT OR REPLACE INTO stats (id, ok_polls, since, built, rebuild_attempted_at)
      SELECT 1, COUNT(*), MIN(polled_at), 1, NULL FROM polls WHERE ok = 1
    `),
  ]);
};
