-- One row per sampler execution, success or failure. raw_json is the
-- verbatim get_machine_status_v1 body — the ground truth that lets us
-- re-derive everything later as understanding of the upstream quirks
-- evolves (see docs/WASH_CONNECT_API.md).
CREATE TABLE polls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  polled_at TEXT NOT NULL,            -- ISO 8601 UTC
  source TEXT NOT NULL,               -- cron expression that fired, or 'manual'
  code TEXT NOT NULL,                 -- WASH site code polled
  ok INTEGER NOT NULL,                -- 1 success, 0 failure
  error TEXT,                         -- failure message when ok = 0
  upstream_ms INTEGER,                -- end-to-end upstream latency
  raw_json TEXT                       -- verbatim upstream body when ok = 1
);

CREATE INDEX idx_polls_polled_at ON polls (polled_at);

-- One row per machine per successful poll: the machine's state and its
-- current/most-recent cycle interval. `status` is upstream's claim;
-- `derived_status` applies the stuck-in_use correction. The heatmap
-- reconstructs cycles from (machine_number, start_time, ends_at) and
-- derives observation coverage from the parent poll's polled_at.
CREATE TABLE usage (
  poll_id INTEGER NOT NULL REFERENCES polls (id),
  machine_number TEXT NOT NULL,
  type TEXT NOT NULL,                 -- 'washer' | 'dryer'
  status TEXT NOT NULL,
  derived_status TEXT NOT NULL,       -- available | in_use | should_be_done | out_of_service
  start_time TEXT,                    -- upstream cycle start, verbatim
  ends_at TEXT                        -- derived cycle end, ISO 8601 UTC
);

CREATE INDEX idx_usage_poll ON usage (poll_id);
