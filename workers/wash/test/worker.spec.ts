import {
  createExecutionContext,
  env,
  fetchMock,
  waitOnExecutionContext,
} from "cloudflare:test";
import { beforeAll, describe, expect, it, vi } from "vitest";
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
      location: { uln: "CA7521809   ", location_name: "20 Crestline Dr" },
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
    expect(body.location).toEqual({ code: "wsh3345", name: "20 Crestline Dr" });
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

describe("bucketFor", () => {
  it("buckets in the configured timezone", () => {
    // 2026-06-08T03:30Z is Sunday 2026-06-07 20:30 PDT.
    const bucket = bucketFor(new Date("2026-06-08T03:30:00Z"), "America/Los_Angeles");
    expect(bucket).toEqual({ dow: 6, hour: 20 });
  });
});
