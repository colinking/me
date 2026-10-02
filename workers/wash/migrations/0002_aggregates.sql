-- Incremental aggregates behind /heatmap (see src/aggregates.ts).
--
-- polls/usage stay the raw record and grow forever; scanning them per
-- request cost O(history) D1 row reads and blew the free tier's daily read
-- budget. The sampler folds each poll into these bounded tables instead.
-- They are derived, so they can be rebuilt from history at any time: set
-- stats.built = 0 and the next sampler run rebuilds everything.

-- Hour-of-week buckets in TIMEZONE: exactly what /heatmap serves (<= 168 rows).
CREATE TABLE buckets (
  dow INTEGER NOT NULL,               -- 0 = Monday .. 6 = Sunday
  hour INTEGER NOT NULL,              -- 0..23
  observed_min INTEGER NOT NULL,      -- 60 per (machine, UTC hour) observed
  hours INTEGER NOT NULL,             -- distinct UTC hours observed
  busy_ms INTEGER NOT NULL,           -- cycle-interval overlap
  PRIMARY KEY (dow, hour)
) WITHOUT ROWID;

-- Dedup sets the sampler probes by primary key (never scanned).
CREATE TABLE machine_hours (
  machine_number TEXT NOT NULL,
  utc_hour TEXT NOT NULL,             -- polled_at truncated to the hour
  PRIMARY KEY (machine_number, utc_hour)
) WITHOUT ROWID;

CREATE TABLE observed_hours (
  utc_hour TEXT PRIMARY KEY
) WITHOUT ROWID;

-- One row per cycle: the furthest valid end estimate seen so far.
CREATE TABLE cycles (
  machine_number TEXT NOT NULL,
  start_time TEXT NOT NULL,           -- upstream cycle start, verbatim
  ends_at TEXT NOT NULL,              -- ISO 8601 UTC
  PRIMARY KEY (machine_number, start_time)
) WITHOUT ROWID;

-- Single-row counters for the /heatmap header fields, plus the rebuild
-- state: `built` = 0 until the other tables reflect all of polls/usage
-- (set it to 0 to force a rebuild on the next sampler run).
CREATE TABLE stats (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  ok_polls INTEGER NOT NULL,
  since TEXT,                         -- first successful poll, ISO 8601 UTC
  built INTEGER NOT NULL DEFAULT 0,
  rebuild_attempted_at TEXT           -- lease + backoff for the rebuild
);

-- The /status fallback looks up the latest good poll per site code; without
-- this an unknown code scanned the whole polls table.
CREATE INDEX idx_polls_code_ok_id ON polls (code, ok, id);
