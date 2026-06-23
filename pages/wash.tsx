import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Head } from "@/components/Head";
import { UsageHeatmap } from "@/components/UsageHeatmap";
import { analytics } from "@/lib/analytics";
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

const PAGE_TITLE =
  "WASH Connect Laundry Status — Live Washer & Dryer Availability";
const PAGE_DESCRIPTION =
  "Check live washer and dryer availability in any WASH-Connect laundry " +
  "room — free, no app or account needed. Enter your site code to see " +
  "which machines are open and how long until one frees up.";

// Rendered both as visible copy and as FAQPage JSON-LD, so the structured
// data can never drift from what's on the page (a Google requirement).
// `a` is the plain-text answer used in both; `rich` optionally replaces the
// visible rendering when the answer needs markup (e.g. a mailto link).
const FAQ: { q: string; a: string; rich?: ReactNode }[] = [
  {
    q: "Does this work for my building?",
    a:
      "Yes, if your laundry room is run by WASH (the machines and signage " +
      "say WASH-Connect). Use the change button above to enter your " +
      "building's site code and you'll see your own machines.",
  },
  {
    q: "How do I find my site code?",
    a:
      "It's printed on the signage or stickers in your laundry room — " +
      "codes look like wsh1234 or W001274.",
  },
  {
    q: "How fresh is the data?",
    a:
      "Status refreshes about once a minute."
  },
  {
    q: "Why does a machine show as available when it is not?",
    a:
      "There are two known issues. First, time remaining is based on the " +
      "machine's original estimate, and machines sometimes underestimate " +
      "how long a load will take — so you may find a machine still " +
      "running for a few more minutes. Second, machines can occasionally " +
      "fail to report a run to WASH, making them look idle while they're " +
      "running. This is relatively rare.",
  },
  {
    q: "Why doesn't my laundry room show any machines?",
    a:
      "Some WASH rooms use payment-only readers that don't report live " +
      "machine status to the data feed this page reads. For those rooms you " +
      "can confirm the location exists, but machine availability can't be " +
      "shown — only rooms with status-reporting hardware appear here.",
  },
  {
    q: "Why is there no historical usage data for my code?",
    a:
      "Historical usage is only recorded for an allowlisted set of site " +
      "codes, to avoid putting unnecessary load on WASH's backend. Email " +
      "me@colinking.co if you'd like your code added.",
    rich: (
      <>
        Historical usage is only recorded for an allowlisted set of site
        codes, to avoid putting unnecessary load on WASH&apos;s backend.{" "}
        <a
          href="mailto:me@colinking.co?subject=Add%20my%20WASH%20code"
          className="text-[#65d091] no-underline hover:text-[#51a774] hover:underline"
        >
          Email me
        </a>{" "}
        if you&apos;d like your code added.
      </>
    ),
  },
  {
    q: "Is this affiliated with WASH?",
    a:
      "No — this is an unofficial, independent tool. It is not endorsed " +
      "by or associated with WASH Multifamily Laundry Systems.",
  },
];

const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebApplication",
      name: "WASH Connect Laundry Status",
      url: "https://colinking.co/wash",
      description: PAGE_DESCRIPTION,
      applicationCategory: "UtilityApplication",
      operatingSystem: "Any",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    },
    {
      "@type": "FAQPage",
      mainEntity: FAQ.map(({ q, a }) => ({
        "@type": "Question",
        name: q,
        acceptedAnswer: { "@type": "Answer", text: a },
      })),
    },
  ],
};

const loadStoredCode = (): string => {
  try {
    const stored = window.localStorage.getItem(CODE_STORAGE_KEY);
    if (stored && CODE_PATTERN.test(stored)) {
      // Codes are case-insensitive; normalize so comparisons (e.g. against
      // DEFAULT_CODE for the heatmap) hold regardless of how it was typed.
      return stored.toLowerCase();
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

  // One event per code viewed per visit, fired on the first successful status
  // load so it can carry what the visitor actually saw (location, machine
  // availability). Visits where status never loads still appear as page views.
  const trackedCode = useRef<string | null>(null);

  // An initial failure (or empty dataset) hides the section; a failed
  // periodic refresh keeps the last good data instead of hiding it.
  const refreshHeatmap = useCallback(async () => {
    try {
      const res = await fetch("/wash/api/heatmap");
      if (res.ok) {
        setHeatmap((await res.json()) as HeatmapResponse);
      }
    } catch {
      // Keep whatever is currently shown.
    }
  }, []);

  // Same cadence as the status poll; new data only lands when the worker's
  // cron samples (every 10 minutes), but the worker's short cache window
  // makes each poll cheap and surfaces fresh samples within a minute or two.
  useEffect(() => {
    refreshHeatmap();
    const interval = setInterval(refreshHeatmap, REFRESH_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshHeatmap();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refreshHeatmap]);

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
      // Stale bodies are the worker's D1 fallback (upstream down);
      // fetchedAt is the archived poll time, so the existing
      // "showing data from X" banner tells the story.
      setError(body.stale ? "live status unavailable" : null);
      setNow(Date.now());
      if (trackedCode.current !== code) {
        trackedCode.current = code;
        const free = (m: Machine) =>
          m.status === "available" || m.status === "should_be_done";
        const washers = body.machines.filter((m) => m.type === "washer");
        const dryers = body.machines.filter((m) => m.type === "dryer");
        analytics.track("Laundry Status Viewed", {
          code,
          locationName: body.location.name,
          isDefaultCode: code === DEFAULT_CODE,
          stale: body.stale ?? false,
          washersAvailable: washers.filter(free).length,
          washersTotal: washers.length,
          dryersAvailable: dryers.filter(free).length,
          dryersTotal: dryers.length,
        });
      }
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
    // Codes are case-insensitive; normalize so comparisons (e.g. against
    // DEFAULT_CODE for the heatmap) hold regardless of how it was typed.
    const next = draft.trim().toLowerCase();
    if (!CODE_PATTERN.test(next)) {
      setDraftError("letters and numbers only");
      return;
    }
    saveStoredCode(next);
    if (next !== code) {
      analytics.track("Wash Code Changed", { code: next, previousCode: code });
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

  // box-border keeps the top border inside min-h-screen (no preflight, so
  // the default is content-box, which would overflow by 5px).
  return (
    <div className="box-border min-h-screen border-t-[5px] border-t-[#65d091]">
      <Head
        title={PAGE_TITLE}
        description={PAGE_DESCRIPTION}
        favicon="/wash-favicon.png"
        ogImage="https://colinking.co/wash-og.png"
        url="https://colinking.co/wash"
      >
        <script
          type="application/ld+json"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: static JSON.stringify of page-owned data
          dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        />
      </Head>

      <div className="mx-auto my-10 max-w-105 px-5 text-[#333] [font-family:var(--font-inconsolata)]">
        <h1 className="text-[24px] font-black">WASH Connect Laundry Status</h1>

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

        {/* `connect`-tier rooms use payment-only hardware that never reports
            machine status to the upstream feed, so machines comes back empty.
            Explain the gap rather than showing a blank list. See
            docs/WASH_CONNECT_API.md. */}
        {data?.location.deviceType === "connect" && !items?.length && (
          <p className="mt-4 rounded-md border border-[#e8c36a] bg-[#e8c36a]/10 p-3 text-[14px]">
            This laundry room&apos;s machines don&apos;t publish live
            availability data, so machine status can&apos;t be shown here.
          </p>
        )}

        {items && items.length > 0 && (
          // No Tailwind preflight in this project: strip the UA list
          // padding so cards align with the headings.
          <ul className="mt-4 flex list-none flex-col gap-3 p-0">
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

        {/* Static, server-rendered copy: this is what search engines and
            agents (which often don't run JS) index — the live status above
            is all client-fetched. Mirrored in the FAQPage JSON-LD. */}
        <section className="mt-12 border-t border-[#eee] pt-6 text-[14px] text-[#555]">
          <h2 className="text-[16px] font-black text-[#333]">
            Check WASH-Connect laundry machines without the app
          </h2>
          <p className="mt-2">
            This page shows live washer and dryer availability for laundry
            rooms run by WASH (
            <a
              href="https://www.getwashconnect.com"
              className="text-[#65d091] no-underline hover:text-[#51a774] hover:underline"
            >
              WASH-Connect
            </a>
            ) — free, with no app, account, or login. See which machines are
            open, which are in use, and roughly how many minutes are left
            before you haul your laundry down.
          </p>
          {/* Collapsed by default via <details>: the answers are still in the
              server-rendered HTML, which is what crawlers index. */}
          {FAQ.map(({ q, a, rich }) => (
            <details key={q} className="mt-4">
              <summary className="cursor-pointer">
                {/* No preflight: strip the h3's UA margins/size so it sits
                    inline next to the disclosure marker. */}
                <h3 className="m-0 ml-1 inline text-[15px] font-black text-[#333]">
                  {q}
                </h3>
              </summary>
              <p className="mt-1 mb-0">{rich ?? a}</p>
            </details>
          ))}
        </section>

        <p className="mt-8 text-[13px] text-[#777]">
          Built by{" "}
          <a href="/" className="text-inherit no-underline hover:underline">
            Colin King
          </a>{" "}
          &middot;{" "}
          <a
            href="https://github.com/colinking/me"
            className="text-inherit no-underline hover:underline"
          >
            [github]
          </a>{" "}
          &middot;{" "}
          <a
            href="mailto:me@colinking.co?subject=Laundry%20page%20feedback"
            className="text-inherit no-underline hover:underline"
          >
            [feedback]
          </a>
        </p>
      </div>
    </div>
  );
};

export default Wash;
