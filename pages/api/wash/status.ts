import type { NextApiRequest, NextApiResponse } from "next";

// WASH Connect (Kiosoft) Firebase backend. See docs/WASH_CONNECT_API.md for
// the endpoint reference and the quirks handled below.
const WASH_API = "https://us-central1-washmobilepay.cloudfunctions.net";
const DEFAULT_CODE = "wsh3345";
const UPSTREAM_TIMEOUT_MS = 10_000;
const SITE_CODE_PATTERN = /^[a-zA-Z0-9]{1,16}$/;

export type MachineStatus =
  | "available"
  | "in_use"
  | "should_be_done"
  | "out_of_service";

export type Machine = {
  number: string;
  type: "washer" | "dryer";
  status: MachineStatus;
  minutesLeft: number | null;
  endsAt: string | null;
};

export type StatusResponse = {
  location: { code: string; name: string | null };
  machines: Machine[];
  fetchedAt: string;
};

type RawMachine = {
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

const fetchWash = async (path: string): Promise<Record<string, unknown>> => {
  const res = await fetch(`${WASH_API}${path}`, {
    headers: { provider: "kiosoft" },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`WASH API returned HTTP ${res.status} for ${path}`);
  }
  const body = (await res.json()) as Record<string, unknown>;
  // Some endpoints embed an error status in the body even on HTTP 200.
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

type SiteLocation = { uln: string; name: string | null };

// Cached per lambda instance; site code → location mappings don't change.
const locationCache = new Map<string, SiteLocation>();

const resolveLocation = async (code: string): Promise<SiteLocation> => {
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

const fetchMachines = async (uln: string): Promise<Machine[]> => {
  const body = await fetchWash(
    `/get_machine_status_v1?uln=${encodeURIComponent(uln)}`,
  );
  const floors = (body.data ?? {}) as Record<string, RawFloor>;

  // The same bt_name can appear on multiple floors; first occurrence wins.
  const seen = new Set<string>();
  const now = new Date();
  const machines: Machine[] = [];
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
        machines.push(machine);
      }
    }
  }
  return machines.sort((a, b) => a.number.localeCompare(b.number));
};

const handler = async (
  req: NextApiRequest,
  res: NextApiResponse<StatusResponse | { error: string }>,
) => {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  const code =
    typeof req.query.code === "string" ? req.query.code : DEFAULT_CODE;
  if (!SITE_CODE_PATTERN.test(code)) {
    res.status(400).json({ error: "invalid site code" });
    return;
  }

  try {
    const { uln, name } = await resolveLocation(code);
    const machines = await fetchMachines(uln);
    // Vercel's CDN keys on the full URL, so each ?code= caches separately.
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=30, stale-while-revalidate=60",
    );
    res.status(200).json({
      location: { code, name },
      machines,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.setHeader("Cache-Control", "no-store");
    res
      .status(502)
      .json({ error: err instanceof Error ? err.message : "upstream error" });
  }
};

export default handler;
