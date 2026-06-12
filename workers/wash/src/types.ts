// API contract shared between the worker and the Next.js page. This module
// must stay platform-neutral (types only, no Workers or DOM references) —
// the site imports from it with `import type`.

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
  // Present when the upstream was unreachable and this body was rebuilt
  // from the sampler's last successful poll; fetchedAt is that poll time.
  stale?: true;
};

export type HeatmapBucket = {
  dow: number; // 0 = Monday .. 6 = Sunday, in `timezone`
  hour: number; // 0..23
  busy: number; // busy machine-minutes, from cycle-interval overlap
  total: number; // observed machine-minutes (excludes out_of_service)
  hours: number; // distinct wall-clock hours observed (~weeks of data)
  utilization: number; // busy / total
};

export type HeatmapResponse = {
  timezone: string;
  generatedAt: string;
  polls: number;
  since: string | null; // first successful poll, ISO 8601 UTC
  // Sparse: buckets with no observations are omitted.
  buckets: HeatmapBucket[];
};
