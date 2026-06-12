// WASH Connect (Kiosoft) Firebase backend client. Ported from the Vercel
// API route (pages/api/wash/status.ts in the site repo) — this is now the
// canonical implementation. See docs/WASH_CONNECT_API.md for the endpoint
// reference and the quirks handled below.
const WASH_API = "https://us-central1-washmobilepay.cloudfunctions.net";
export const DEFAULT_CODE = "wsh3345";
export const SITE_CODE_PATTERN = /^[a-zA-Z0-9]{1,16}$/;
// Successful upstream calls complete in well under a second, but the
// backend intermittently hangs for 10s+ (~hourly in production). A short
// deadline plus one retry beats waiting out a hang that never resolves.
const UPSTREAM_TIMEOUT_MS = 4_000;

import type { Machine } from "./types";

export type { Machine, MachineStatus, StatusResponse } from "./types";

export type RawMachine = {
  machine_number?: string;
  bt_name?: string;
  type?: string;
  status?: string;
  time_remaining?: number;
  start_time?: string;
};

type RawFloor = {
  name?: string;
  machines?: RawMachine[];
};

const fetchWashOnce = async (path: string): Promise<Record<string, unknown>> => {
  const res = await fetch(`${WASH_API}${path}`, {
    headers: { provider: "kiosoft" },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!res.ok) {
    const err = new Error(`WASH API returned HTTP ${res.status} for ${path}`);
    if (res.status >= 500) {
      (err as { retryable?: boolean }).retryable = true;
    }
    throw err;
  }
  const body = (await res.json()) as Record<string, unknown>;
  // Some endpoints embed an error status in the body even on HTTP 200.
  // Those (and errorCode bodies) are real answers, not transient faults,
  // so they are never retried.
  if (
    typeof body.status === "number" &&
    body.status !== 200 &&
    body.status !== 0
  ) {
    throw new Error(`WASH API returned status ${body.status} for ${path}`);
  }
  const error = body.error as { errorCode?: number } | undefined;
  if (error?.errorCode) {
    throw new Error(`WASH API returned error ${error.errorCode} for ${path}`);
  }
  return body;
};

// Timeouts (AbortSignal.timeout → TimeoutError), transport failures
// (fetch → TypeError), and 5xx responses are transient; one retry covers
// the intermittent hang without piling on a struggling backend.
const isRetryable = (err: unknown): boolean =>
  err instanceof Error &&
  (err.name === "TimeoutError" ||
    err.name === "TypeError" ||
    (err as { retryable?: boolean }).retryable === true);

const fetchWash = async (path: string): Promise<Record<string, unknown>> => {
  try {
    return await fetchWashOnce(path);
  } catch (err) {
    if (!isRetryable(err)) {
      throw err;
    }
    return fetchWashOnce(path);
  }
};

export type SiteLocation = { uln: string; name: string | null };

// Cached per isolate; site code → location mappings don't change.
const locationCache = new Map<string, SiteLocation>();

// Best-effort lookup for fallback responses built while the upstream is
// down (no network call to resolve the name is possible then).
export const cachedLocation = (code: string): SiteLocation | undefined =>
  locationCache.get(code);

export const resolveLocation = async (code: string): Promise<SiteLocation> => {
  const cached = locationCache.get(code);
  if (cached) {
    return cached;
  }
  const body = await fetchWash(`/locations?srcode=${encodeURIComponent(code)}`);
  const location = body.location as
    | { uln?: string; location_name?: string }
    | undefined;
  // The uln comes back with trailing whitespace; always strip it.
  const uln = location?.uln?.trim();
  if (!uln) {
    throw new Error(`unknown site code: ${code}`);
  }
  const resolved = { uln, name: location?.location_name?.trim() || null };
  locationCache.set(code, resolved);
  return resolved;
};

const deriveMachine = (raw: RawMachine, now: Date): Machine | null => {
  const number = raw.machine_number;
  const type = raw.type;
  if (!number || (type !== "washer" && type !== "dryer")) {
    return null;
  }

  // End of the most recent reported cycle, when computable. For in_use
  // machines this is when the cycle should finish; for available machines
  // it's when the machine was last used.
  const startMs = raw.start_time ? Date.parse(raw.start_time) : Number.NaN;
  const endsAtMs =
    !Number.isNaN(startMs) && typeof raw.time_remaining === "number"
      ? startMs + raw.time_remaining * 60_000
      : null;
  const endsAt = endsAtMs === null ? null : new Date(endsAtMs).toISOString();

  if (raw.status === "available") {
    return { number, type, status: "available", minutesLeft: null, endsAt };
  }
  if (raw.status === "out_of_service") {
    return {
      number,
      type,
      status: "out_of_service",
      minutesLeft: null,
      endsAt: null,
    };
  }
  if (raw.status !== "in_use") {
    return null;
  }

  // `status` gets stuck on `in_use` after a cycle ends (start_time can be
  // days old), and `time_remaining` is a snapshot from cycle start. If the
  // computed end has passed, report `should_be_done` — not `available`,
  // since unreported cycles and extensions aren't visible through this
  // endpoint (see docs/WASH_CONNECT_API.md).
  if (endsAtMs === null) {
    // Fall back to trusting the reported status.
    return {
      number,
      type,
      status: "in_use",
      minutesLeft:
        typeof raw.time_remaining === "number" ? raw.time_remaining : null,
      endsAt: null,
    };
  }

  const minutesLeft = Math.ceil((endsAtMs - now.getTime()) / 60_000);
  if (minutesLeft <= 0) {
    return { number, type, status: "should_be_done", minutesLeft: null, endsAt };
  }
  return { number, type, status: "in_use", minutesLeft, endsAt };
};

// A machine paired with the upstream fields it was derived from, so the
// sampler can store both sides without re-parsing raw_json.
export type ObservedMachine = { machine: Machine; raw: RawMachine };

export type MachinesResult = {
  machines: ObservedMachine[];
  // Verbatim get_machine_status_v1 body, for raw archival.
  rawBody: Record<string, unknown>;
};

// Derive machines from a get_machine_status_v1 body. Also used to rebuild
// status from an archived poll's raw_json, re-deriving against the current
// clock (so a cycle that ended since the poll reads should_be_done).
export const parseMachines = (
  body: Record<string, unknown>,
  now: Date,
): ObservedMachine[] => {
  const floors = (body.data ?? {}) as Record<string, RawFloor>;

  // The same bt_name can appear on multiple floors; first occurrence wins.
  const seen = new Set<string>();
  const machines: ObservedMachine[] = [];
  for (const floor of Object.values(floors)) {
    for (const raw of floor.machines ?? []) {
      const key = raw.bt_name ?? raw.machine_number;
      if (key) {
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
      }
      const machine = deriveMachine(raw, now);
      if (machine) {
        machines.push({ machine, raw });
      }
    }
  }
  machines.sort((a, b) => a.machine.number.localeCompare(b.machine.number));
  return machines;
};

export const fetchMachines = async (uln: string): Promise<MachinesResult> => {
  const body = await fetchWash(
    `/get_machine_status_v1?uln=${encodeURIComponent(uln)}`,
  );
  return { machines: parseMachines(body, new Date()), rawBody: body };
};
