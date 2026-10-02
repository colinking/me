import {
  createExecutionContext,
  env,
  fetchMock,
  waitOnExecutionContext,
} from "cloudflare:test";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ensureAggregates } from "../src/aggregates";
import { bucketFor, heatmap } from "../src/heatmap";
import { samplePoll } from "../src/sample";
import worker from "../src/index";

const UPSTREAM = "https://us-central1-washmobilepay.cloudfunctions.net";

// Fixed clock (Date only — real timers) so cycle intervals and hour-of-week
// buckets are deterministic: Sunday 2026-06-07 20:30 PDT.
const NOW = new Date("2026-06-08T03:30:00Z");

const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

const washerAvailable = {
  machine_number: "001",
  bt_name: "W001",
  type: "washer",
  status: "available",
};
// Started 5 minutes ago with 45 to go: runs 03:25Z–04:10Z.
const dryerRunning = () => ({
  machine_number: "002",
  bt_name: "D002",
  type: "dryer",
  status: "in_use",
  start_time: minutesAgo(5),
  time_remaining: 45,
});
const dryerBroken = {
  machine_number: "003",
  bt_name: "D003",
  type: "dryer",
  status: "out_of_service",
};
// The stuck-in_use quirk: reported in_use, but the cycle ended long ago.
const dryerStale = () => ({
  machine_number: "002",
  bt_name: "D002",
  type: "dryer",
  status: "in_use",
  start_time: minutesAgo(3 * 24 * 60),
  time_remaining: 60,
});

const mockMachines = (machines: unknown[]) => {
  fetchMock
    .get(UPSTREAM)
    .intercept({ path: /^\/get_machine_status_v1/ })
    .reply(200, {
      status: 200,
      data: { "1": { name: "LR001", machines } },
    });
};

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  fetchMock.activate();
  fetchMock.disableNetConnect();
  // resolveLocation caches per isolate, so this may be hit once or never
  // depending on test order — persist and don't assert on it.
  fetchMock
    .get(UPSTREAM)
    .intercept({ path: /^\/locations/ })
    .reply(200, {
      status: 200,
      location: {
        uln: "CA7521809   ",
        location_name: "20 Crestline Dr",
        device_type: "prime",
      },
    })
    .persist();
});

describe("samplePoll", () => {
  it("records a poll row plus one sample per machine", async () => {
    mockMachines([washerAvailable, dryerRunning(), dryerBroken]);
    const outcome = await samplePoll(env, "test");
    expect(outcome.kind).toBe("sampled");

    const poll = await env.WASH_DB.prepare(
      "SELECT * FROM polls ORDER BY id DESC LIMIT 1",
    ).first<Record<string, unknown>>();
    expect(poll?.ok).toBe(1);
    expect(poll?.code).toBe("wsh3345");
    expect(poll?.source).toBe("test");
    // raw_json is the verbatim upstream body.
    const raw = JSON.parse(poll?.raw_json as string);
    expect(raw.data["1"].machines).toHaveLength(3);

    const rows = await env.WASH_DB.prepare(
      "SELECT * FROM usage ORDER BY machine_number",
    ).all<Record<string, unknown>>();
    expect(rows.results).toHaveLength(3);
    expect(rows.results.map((r) => r.derived_status)).toEqual([
      "available",
      "in_use",
      "out_of_service",
    ]);
    // The running dryer's cycle interval: 03:25Z start, +45 min.
    expect(rows.results[1]).toMatchObject({
      type: "dryer",
      status: "in_use",
      start_time: minutesAgo(5),
      ends_at: new Date(NOW.getTime() + 40 * 60_000).toISOString(),
    });
  });

  it("derives should_be_done for stuck in_use machines", async () => {
    mockMachines([dryerStale()]);
    await samplePoll(env, "test");
    const row = await env.WASH_DB.prepare(
      "SELECT status, derived_status FROM usage",
    ).first<{ status: string; derived_status: string }>();
    expect(row).toEqual({ status: "in_use", derived_status: "should_be_done" });
  });

  it("skips when the last successful poll is too recent", async () => {
    mockMachines([washerAvailable]);
    expect((await samplePoll(env, "test")).kind).toBe("sampled");
    expect((await samplePoll(env, "test")).kind).toBe("skipped");
  });

  it("records failed polls with the error", async () => {
    // 5xx is retried once, so both attempts need an intercept.
    fetchMock
      .get(UPSTREAM)
      .intercept({ path: /^\/get_machine_status_v1/ })
      .reply(500, {})
      .times(2);
    const outcome = await samplePoll(env, "test");
    expect(outcome.kind).toBe("failed");

    const poll = await env.WASH_DB.prepare(
      "SELECT ok, error FROM polls",
    ).first<{ ok: number; error: string }>();
    expect(poll?.ok).toBe(0);
    expect(poll?.error).toContain("HTTP 500");
  });
});

describe("fetch handler", () => {
  it("serves /status in the Vercel route's shape", async () => {
    mockMachines([washerAvailable, dryerRunning()]);
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request("https://wash.local/status") as never,
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(
      "public, s-maxage=30, stale-while-revalidate=60",
    );
    const body = (await res.json()) as Record<string, any>;
    expect(body.location).toEqual({
      code: "wsh3345",
      name: "20 Crestline Dr",
      deviceType: "prime",
    });
    expect(body.machines).toHaveLength(2);
    expect(body.machines[0]).toMatchObject({
      number: "001",
      type: "washer",
      status: "available",
      minutesLeft: null,
    });
    expect(body.machines[1].status).toBe("in_use");
    expect(body.machines[1].minutesLeft).toBeGreaterThan(0);
  });

  it("serves /heatmap from sampled data", async () => {
    mockMachines([washerAvailable, dryerRunning()]);
    await samplePoll(env, "test");

    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request("https://wash.local/heatmap") as never,
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(
      "public, s-maxage=60, stale-while-revalidate=600",
    );
    const body = (await res.json()) as Record<string, any>;
    expect(body.timezone).toBe("America/Los_Angeles");
    expect(body.polls).toBe(1);
    expect(typeof body.since).toBe("string");
    // One observed hour (Sun 8pm PDT): washer + dryer polled once each =
    // 120 observed minutes; the dryer's cycle (03:25Z-04:10Z) counts its
    // expected runtime, 35 minutes of which fall in this hour — the 04Z
    // remainder drops out until that hour is first polled.
    expect(body.buckets).toHaveLength(1);
    expect(body.buckets[0]).toMatchObject({
      dow: 6,
      hour: 20,
      busy: 35,
      total: 120,
      hours: 1,
    });
  });

  it("retries once and succeeds after a transient 5xx", async () => {
    fetchMock
      .get(UPSTREAM)
      .intercept({ path: /^\/get_machine_status_v1/ })
      .reply(500, {});
    mockMachines([washerAvailable]);

    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request("https://wash.local/status") as never,
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.stale).toBeUndefined();
    expect(body.machines).toHaveLength(1);
  });

  it("falls back to the last successful poll when the upstream stays down", async () => {
    mockMachines([washerAvailable, dryerRunning()]);
    await samplePoll(env, "test");

    fetchMock
      .get(UPSTREAM)
      .intercept({ path: /^\/get_machine_status_v1/ })
      .reply(500, {})
      .times(2);

    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request("https://wash.local/status") as never,
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    // Stale bodies must not linger in shared caches.
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as Record<string, any>;
    expect(body.stale).toBe(true);
    expect(body.fetchedAt).toBe(NOW.toISOString());
    expect(body.location.code).toBe("wsh3345");
    expect(body.machines).toHaveLength(2);
    expect(body.machines[1].status).toBe("in_use");
  });

  it("still returns 502 for site codes with no poll history", async () => {
    fetchMock
      .get(UPSTREAM)
      .intercept({ path: /^\/get_machine_status_v1/ })
      .reply(500, {})
      .times(2);

    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request("https://wash.local/status?code=other42") as never,
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(502);
  });

  it("rejects invalid site codes", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request("https://wash.local/status?code=../etc") as never,
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
  });
});

describe("heatmap", () => {
  it("weights by cycle minutes and excludes out_of_service", async () => {
    mockMachines([washerAvailable, dryerRunning(), dryerBroken]);
    await samplePoll(env, "test");

    const result = await heatmap(env);
    expect(result.polls).toBe(1);
    expect(result.since).not.toBeNull();
    // The broken dryer contributes neither coverage nor cycles, so the
    // observed hour holds 2 machines x 60 min; the running dryer counts
    // its expected runtime, 35 minutes of which fall in this hour.
    expect(result.buckets).toHaveLength(1);
    // 2 machines x 60 min = 120 machine-minutes, but 1 wall-clock hour.
    expect(result.buckets[0]).toMatchObject({ busy: 35, total: 120, hours: 1 });
    expect(result.buckets[0].utilization).toBeCloseTo(35 / 120);
  });

  it("splits a finished cycle across hour buckets", async () => {
    // Cycle 02:40Z-03:20Z, finished before "now": 20 minutes in each of
    // the two UTC hours (Sun 7pm and Sun 8pm PDT). Two polls provide
    // coverage for both hours.
    const dryerDone = {
      machine_number: "002",
      bt_name: "D002",
      type: "dryer",
      status: "in_use",
      start_time: minutesAgo(50),
      time_remaining: 40,
    };
    mockMachines([dryerDone]);
    vi.setSystemTime(new Date("2026-06-08T02:45:00Z"));
    await samplePoll(env, "test");
    vi.setSystemTime(NOW);
    mockMachines([dryerDone]);
    await samplePoll(env, "test");

    const result = await heatmap(env);
    expect(result.buckets).toEqual([
      expect.objectContaining({ dow: 6, hour: 19, busy: 20, total: 60, hours: 1 }),
      expect.objectContaining({ dow: 6, hour: 20, busy: 20, total: 60, hours: 1 }),
    ]);
  });
});

describe("aggregates", () => {
  const runningDryer = (startMinutesAgo: number, remaining: number) => ({
    machine_number: "002",
    bt_name: "D002",
    type: "dryer",
    status: "in_use",
    start_time: minutesAgo(startMinutesAgo),
    time_remaining: remaining,
  });

  it("counts only the extension when a cycle's estimate grows", async () => {
    // 03:25Z start, 10 min: busy 10 in Sun 8pm PDT.
    mockMachines([runningDryer(5, 10)]);
    await samplePoll(env, "test");
    // Same cycle now estimated to 03:45Z: +10 min, still one machine-hour.
    vi.setSystemTime(new Date("2026-06-08T03:40:00Z"));
    mockMachines([runningDryer(5, 20)]);
    await samplePoll(env, "test");
    // A shorter estimate later never takes busy time back.
    vi.setSystemTime(new Date("2026-06-08T03:50:00Z"));
    mockMachines([runningDryer(5, 15)]);
    await samplePoll(env, "test");
    vi.setSystemTime(NOW);

    const result = await heatmap(env);
    expect(result.polls).toBe(3);
    expect(result.buckets).toEqual([
      expect.objectContaining({ dow: 6, hour: 20, busy: 20, total: 60, hours: 1 }),
    ]);
    const cycles = await env.WASH_DB.prepare("SELECT * FROM cycles").all();
    expect(cycles.results).toEqual([
      { machine_number: "002", start_time: minutesAgo(5), ends_at: minutesAgo(-15) },
    ]);
  });

  it("rebuilds from history to the same result as incremental sampling", async () => {
    mockMachines([washerAvailable, runningDryer(50, 40), dryerBroken]);
    vi.setSystemTime(new Date("2026-06-08T02:45:00Z"));
    await samplePoll(env, "test");
    vi.setSystemTime(NOW);
    mockMachines([washerAvailable, runningDryer(50, 40), dryerBroken]);
    await samplePoll(env, "test");
    const incremental = await heatmap(env);
    expect(incremental.buckets).toHaveLength(2);

    // Corrupt the aggregates and clear the built flag: the next sampler
    // run must rebuild everything from polls/usage.
    await env.WASH_DB.batch([
      env.WASH_DB.prepare("UPDATE buckets SET busy_ms = 0, observed_min = 1, hours = 9"),
      env.WASH_DB.prepare("DELETE FROM cycles"),
      env.WASH_DB.prepare("UPDATE stats SET built = 0, ok_polls = 99"),
    ]);
    expect(await ensureAggregates(env)).toBe(true);
    expect(await ensureAggregates(env)).toBe(false);

    const rebuilt = await heatmap(env);
    expect(rebuilt.buckets).toEqual(incremental.buckets);
    expect(rebuilt.polls).toBe(incremental.polls);
    expect(rebuilt.since).toBe(incremental.since);
  });

  it("retries a failed rebuild at most every six hours", async () => {
    mockMachines([washerAvailable]);
    await samplePoll(env, "test");
    const attemptedAgo = (hours: number) =>
      new Date(NOW.getTime() - hours * 3600_000).toISOString();

    // Stale aggregates with a recent attempt: leave them alone for now.
    await env.WASH_DB.prepare(
      "UPDATE stats SET built = 0, rebuild_attempted_at = ?1",
    )
      .bind(attemptedAgo(1))
      .run();
    expect(await ensureAggregates(env)).toBe(false);

    // Once the backoff has passed the rebuild runs and releases the lease.
    await env.WASH_DB.prepare("UPDATE stats SET rebuild_attempted_at = ?1")
      .bind(attemptedAgo(7))
      .run();
    expect(await ensureAggregates(env)).toBe(true);
    expect(await ensureAggregates(env)).toBe(false);
    const stats = await env.WASH_DB.prepare("SELECT * FROM stats").first();
    expect(stats).toMatchObject({ ok_polls: 1, built: 1, rebuild_attempted_at: null });
  });

  it("records a poll that reports no machines", async () => {
    // `connect` sites return an empty data object (docs/WASH_CONNECT_API.md).
    mockMachines([]);
    const outcome = await samplePoll(env, "test");
    expect(outcome).toMatchObject({ kind: "sampled", machines: 0 });

    const result = await heatmap(env);
    expect(result.polls).toBe(1);
    expect(result.since).toBe(NOW.toISOString());
    expect(result.buckets).toEqual([]);
  });

  it("serves /heatmap without touching the raw history tables", async () => {
    mockMachines([washerAvailable, dryerRunning()]);
    await samplePoll(env, "test");
    const before = await heatmap(env);

    // If /heatmap scanned history, this would make it throw.
    await env.WASH_DB.batch([
      env.WASH_DB.prepare("DROP TABLE usage"),
      env.WASH_DB.prepare("DROP TABLE polls"),
    ]);
    const after = await heatmap(env);
    expect(after.buckets).toEqual(before.buckets);
    expect(after.polls).toBe(1);
  });
});

describe("bucketFor", () => {
  it("buckets in the configured timezone", () => {
    // 2026-06-08T03:30Z is Sunday 2026-06-07 20:30 PDT.
    const bucket = bucketFor(new Date("2026-06-08T03:30:00Z"), "America/Los_Angeles");
    expect(bucket).toEqual({ dow: 6, hour: 20 });
  });
});
