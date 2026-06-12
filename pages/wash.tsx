import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Head } from "@/components/Head";
import { UsageHeatmap } from "@/components/UsageHeatmap";
import type {
  HeatmapResponse,
  Machine,
  StatusResponse,
} from "@/workers/wash/src/types";

const REFRESH_INTERVAL_MS = 60_000;
const TICK_INTERVAL_MS = 15_000;

const DEFAULT_CODE = "wsh3345";
const CODE_STORAGE_KEY = "wash:code";
// Mirrors the API's validation (workers/wash/src/wash.ts).
const CODE_PATTERN = /^[a-zA-Z0-9]{1,16}$/;

const loadStoredCode = (): string => {
  try {
    const stored = window.localStorage.getItem(CODE_STORAGE_KEY);
    if (stored && CODE_PATTERN.test(stored)) {
      return stored;
    }
  } catch {
    // Storage unavailable (private mode, blocked) — fall through.
  }
  return DEFAULT_CODE;
};

const saveStoredCode = (code: string) => {
  try {
    window.localStorage.setItem(CODE_STORAGE_KEY, code);
  } catch {
    // Best effort; the code still applies for this visit.
  }
};

// styles/globals.css doesn't include Tailwind's preflight, so native button
// chrome (border, background, font) must be stripped explicitly.
const TextButton = ({
  children,
  onClick,
  submit,
  muted,
}: {
  children: string;
  onClick?: () => void;
  submit?: boolean;
  muted?: boolean;
}) => (
  <button
    type={submit ? "submit" : "button"}
    onClick={onClick}
    className={`cursor-pointer appearance-none border-0 bg-transparent p-0 [font:inherit] ${
      muted
        ? "text-[#777] hover:underline"
        : "text-[#65d091] hover:text-[#51a774] hover:underline"
    }`}
  >
    [{children}]
  </button>
);

type Display = {
  label: string;
  detail: string | null;
  detailClasses?: string;
  free: boolean;
  classes: string;
};

const timeAgo = (ms: number): string => {
  const minutes = Math.max(Math.round(ms / 60_000), 1);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return `${hours}h`;
  }
  return `${Math.round(hours / 24)}d`;
};

const JUST_FINISHED_MS = 15 * 60_000;

// "last used 5m ago" hints that someone may still have stuff in the machine.
// Within 15 minutes of a cycle ending that's likely enough to warrant a
// louder warning: bold, in the same amber as the in-use state.
const availableDisplay = (machine: Machine, now: number): Display => {
  const endedAgo = machine.endsAt
    ? now - new Date(machine.endsAt).getTime()
    : null;
  if (endedAgo !== null && endedAgo > 0 && endedAgo < JUST_FINISHED_MS) {
    return {
      label: "available",
      detail: `just finished ${timeAgo(endedAgo)} ago`,
      detailClasses: "font-bold text-[#9a7320]",
      free: true,
      classes: "border-[#65d091] bg-[#65d091]/10",
    };
  }
  return {
    label: "available",
    detail:
      endedAgo !== null && endedAgo > 0
        ? `last used ${timeAgo(endedAgo)} ago`
        : null,
    free: true,
    classes: "border-[#65d091] bg-[#65d091]/10",
  };
};

// Re-derive the countdown from endsAt on every tick rather than decrementing
// the snapshot minutesLeft. A machine whose computed end passes between
// fetches flips to available locally, matching what the API would say.
//
// `should_be_done` (reported cycle is over but the machine never confirmed)
// is rendered as plain available for now. The API keeps the distinction;
// a future iteration may surface an explanation of the uncertainty (cycles
// that never report, invisible extensions — see docs/WASH_CONNECT_API.md).
const displayFor = (machine: Machine, now: number): Display => {
  switch (machine.status) {
    case "available":
    case "should_be_done":
      return availableDisplay(machine, now);
    case "out_of_service":
      return {
        label: "out of service",
        detail: null,
        free: false,
        classes: "border-[#ddd] bg-[#f7f7f7] text-[#999]",
      };
    default: {
      const minutesLeft = machine.endsAt
        ? Math.ceil((new Date(machine.endsAt).getTime() - now) / 60_000)
        : machine.minutesLeft;
      if (minutesLeft !== null && minutesLeft <= 0) {
        return availableDisplay(machine, now);
      }
      return {
        label: "in use",
        detail: minutesLeft !== null ? `~${minutesLeft} min left` : null,
        free: false,
        classes: "border-[#e8c36a] bg-[#e8c36a]/10",
      };
    }
  }
};

const Wash = () => {
  // null until the stored code is read on mount, so the server render and
  // first client render match.
  const [code, setCode] = useState<string | null>(null);
  const [data, setData] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [heatmap, setHeatmap] = useState<HeatmapResponse | null>(null);

  useEffect(() => {
    setCode(loadStoredCode());
  }, []);

  // Usage history changes slowly; fetch once per visit. Failures or an
  // empty dataset just hide the section.
  useEffect(() => {
    fetch("/wash/api/heatmap")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: HeatmapResponse | null) => setHeatmap(body))
      .catch(() => setHeatmap(null));
  }, []);

  const refresh = useCallback(async () => {
    if (!code) {
      return;
    }
    try {
      const res = await fetch(
        `/wash/api/status?code=${encodeURIComponent(code)}`,
      );
      const body = (await res.json()) as StatusResponse & { error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setData(body);
      setError(null);
      setNow(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to fetch");
    }
  }, [code]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, REFRESH_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refresh]);

  const submitCode = (event: FormEvent) => {
    event.preventDefault();
    const next = draft.trim();
    if (!CODE_PATTERN.test(next)) {
      setDraftError("letters and numbers only");
      return;
    }
    saveStoredCode(next);
    if (next !== code) {
      // Drop the old location's data so the page shows a clean loading state
      // instead of stale machines under a new code.
      setData(null);
      setError(null);
      setCode(next);
    }
    setEditing(false);
    setDraftError(null);
  };

  const startEditing = () => {
    setDraft(code ?? "");
    setDraftError(null);
    setEditing(true);
  };

  useEffect(() => {
    const ticker = setInterval(() => setNow(Date.now()), TICK_INTERVAL_MS);
    return () => clearInterval(ticker);
  }, []);

  const items = data?.machines.map((machine) => ({
    machine,
    display: displayFor(machine, now),
  }));

  return (
    <div className="min-h-screen border-t-[5px] border-t-[#65d091]">
      <Head title="Laundry" description="Live washer/dryer availability" />

      <div className="mx-auto my-10 max-w-105 px-5 text-[#333] [font-family:var(--font-inconsolata)]">
        <h1 className="text-[24px] font-black">WASH Connect</h1>

        {code && !editing && (
          <p className="mt-1 text-[15px] text-[#777]">
            {data?.location.name && <>{data.location.name} &middot; </>}
            {code} <TextButton onClick={startEditing}>change</TextButton>
          </p>
        )}

        {editing && (
          <form
            onSubmit={submitCode}
            className="mt-1 flex items-center gap-2 text-[15px]"
          >
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              aria-label="WASH site code"
              placeholder="site code"
              className="w-32 rounded-md border border-[#ccc] bg-white px-2 py-0.5 text-[14px] [font-family:inherit]"
            />
            <TextButton submit>save</TextButton>
            <TextButton muted onClick={() => setEditing(false)}>
              cancel
            </TextButton>
          </form>
        )}

        {editing && draftError && (
          <p className="mt-1 text-[13px] text-[#b05252]">{draftError}</p>
        )}

        <div className="mt-8 flex items-baseline justify-between">
          <h2 className="text-[18px] font-black">Laundry machines</h2>
          {data && (
            <span className="text-[12px] text-[#999]">
              updated{" "}
              {new Date(data.fetchedAt).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
          )}
        </div>

        {error && data && (
          <p className="mt-4 rounded-md border border-[#e0a0a0] bg-[#e0a0a0]/10 p-3 text-[14px]">
            Couldn&apos;t refresh ({error}) &mdash; showing data from{" "}
            {new Date(data.fetchedAt).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            })}
            .
          </p>
        )}

        {error && !data && (
          <div className="mt-6 rounded-md border border-[#e0a0a0] bg-[#e0a0a0]/10 p-5 text-[15px]">
            <p className="font-bold">Couldn&apos;t load machine status.</p>
            <p className="mt-1 text-[14px] text-[#777]">{error}</p>
            <p className="mt-3">
              <TextButton onClick={refresh}>retry</TextButton>
            </p>
          </div>
        )}

        {!error && !data && <p className="mt-4 text-[#777]">Loading&hellip;</p>}

        {items && (
          <ul className="mt-4 flex flex-col gap-3">
            {items.map(({ machine, display }) => (
              <li
                key={`${machine.type}-${machine.number}`}
                className={`flex items-center justify-between rounded-md border p-4 ${display.classes}`}
              >
                <span className="font-bold capitalize">
                  {machine.type} #{machine.number.replace(/^0+(?=\d)/, "")}
                </span>
                <span className="text-right">
                  <span className="font-bold">{display.label}</span>
                  {display.detail && (
                    <span
                      className={`block text-[13px] ${display.detailClasses ?? "text-[#777]"}`}
                    >
                      {display.detail}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* The sampler only observes the default location, so the heatmap
            would be wrong for any other site code. */}
        {code === DEFAULT_CODE && heatmap && heatmap.buckets.length > 0 && (
          <div className="mt-10">
            <UsageHeatmap data={heatmap} />
          </div>
        )}

      </div>
    </div>
  );
};

export default Wash;
