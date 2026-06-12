// Generates SQL that fills the LOCAL D1 with plausible fake usage history,
// so the heatmap can be exercised end-to-end before real data accumulates.
// Never run the output against production — it deletes existing rows.
//
//   node scripts/generate-seed.mjs > .wrangler/seed.sql
//   npx wrangler d1 execute wash --local --file .wrangler/seed.sql
//
// Simulates the sampler faithfully: a poll every 10 minutes for 8 weeks,
// machines starting cycles at rates tuned to a residential pattern
// (weekday evening rush, weekend midday peaks). Samples carry real
// start_time/ends_at intervals, since the heatmap aggregates cycle
// minutes, not poll instants.

const WEEKS = 8;
const STEP_MS = 10 * 60_000;
// Monday 00:00 PDT. The simulation uses a fixed -7h offset; close enough
// for fake data.
const START_MS = Date.parse("2026-04-06T07:00:00Z");
const TZ_OFFSET_MS = -7 * 3600_000;

const MACHINES = [
  { number: "001", type: "washer", cycleMs: 30 * 60_000 },
  { number: "002", type: "dryer", cycleMs: 50 * 60_000 },
  { number: "003", type: "dryer", cycleMs: 50 * 60_000 },
];

// Deterministic PRNG so the seed is reproducible.
const mulberry32 = (seed) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const rand = mulberry32(42);

const bump = (hour, center, width, height) => {
  const distance = Math.min(Math.abs(hour - center), 24 - Math.abs(hour - center));
  return height * Math.exp(-((distance / width) ** 2));
};

// Target utilization (fraction of time busy) by local hour-of-week.
const utilization = (dow, hour) => {
  const weekend = dow >= 5;
  let p = 0.03;
  if (weekend) {
    p += bump(hour, 12, 4.5, dow === 6 ? 0.68 : 0.55);
    p += bump(hour, 19, 2.5, 0.3);
  } else {
    p += bump(hour, 8, 1.5, 0.12);
    p += bump(hour, 20, 2.5, 0.5);
  }
  return Math.min(Math.max(p, 0.01), 0.95);
};

const lines = ["DELETE FROM usage;", "DELETE FROM polls;"];
const usageRows = [];
const pollRows = [];

// busyUntil/cycleStart/cycleEnd persist across polls so available machines
// keep reporting their last finished cycle, like the real backend.
const state = MACHINES.map(() => ({ cycleStart: null, cycleEnd: null }));

let pollId = 0;
for (let t = START_MS; t < START_MS + WEEKS * 7 * 24 * 3600_000; t += STEP_MS) {
  pollId += 1;
  const iso = new Date(t).toISOString();
  const dow = Math.floor((t - START_MS) / 86_400_000) % 7;
  const hour = Math.floor((t + TZ_OFFSET_MS) / 3600_000) % 24;
  pollRows.push(`(${pollId}, '${iso}', 'seed', 'wsh3345', 1, 0, NULL)`);

  MACHINES.forEach((machine, i) => {
    const s = state[i];
    const idle = s.cycleEnd === null || t >= s.cycleEnd;
    if (idle) {
      // P(start this step) targeting the bucket's utilization: busy
      // fraction p needs starts at rate p/(1-p) per busy-duration.
      const p = utilization(dow, hour);
      if (rand() < ((p / (1 - p)) * STEP_MS) / machine.cycleMs) {
        s.cycleStart = t + Math.floor(rand() * STEP_MS);
        s.cycleEnd = s.cycleStart + machine.cycleMs;
      }
    }
    const busy = s.cycleStart !== null && t >= s.cycleStart && t < s.cycleEnd;
    const status = busy ? "in_use" : "available";
    const start = s.cycleStart === null ? "NULL" : `'${new Date(s.cycleStart).toISOString()}'`;
    const end = s.cycleStart === null ? "NULL" : `'${new Date(s.cycleEnd).toISOString()}'`;
    usageRows.push(
      `(${pollId}, '${machine.number}', '${machine.type}', '${status}', '${status}', ${start}, ${end})`,
    );
  });
}

const BATCH = 500;
for (let i = 0; i < pollRows.length; i += BATCH) {
  lines.push(
    "INSERT INTO polls (id, polled_at, source, code, ok, upstream_ms, raw_json) VALUES",
    `${pollRows.slice(i, i + BATCH).join(",\n")};`,
  );
}
for (let i = 0; i < usageRows.length; i += BATCH) {
  lines.push(
    "INSERT INTO usage (poll_id, machine_number, type, status, derived_status, start_time, ends_at) VALUES",
    `${usageRows.slice(i, i + BATCH).join(",\n")};`,
  );
}
console.log(lines.join("\n"));
