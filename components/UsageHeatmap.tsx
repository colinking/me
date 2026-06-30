import { Fragment, useEffect, useMemo, useState } from "react";
import type { HeatmapBucket, HeatmapResponse } from "@/workers/wash/src/types";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

const WEEKDAY_TO_DOW: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

// Mirror the worker's `bucketFor`: which (dow, hour) cell is "now" in the
// location's timezone, so the highlight tracks the laundry room's clock
// rather than the visitor's.
const currentBucket = (timeZone: string): { dow: number; hour: number } | null => {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "numeric",
      hourCycle: "h23",
    }).formatToParts(new Date());
    const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? Number.NaN);
    const dow = WEEKDAY_TO_DOW[weekday];
    if (dow === undefined || Number.isNaN(hour)) {
      return null;
    }
    return { dow, hour };
  } catch {
    return null;
  }
};

const formatHour = (hour: number): string => {
  if (hour === 0) {
    return "12am";
  }
  if (hour === 12) {
    return "12pm";
  }
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
};

const formatSince = (iso: string): string =>
  new Date(iso).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

// Lerp from near-white to deep amber (the "in use" hue family), weighted
// relative to the busiest cell. Cells with no observations render as a
// bare outline instead, so filled-but-idle still reads as data.
const heatColor = (utilization: number, max: number): string => {
  const t = max > 0 ? utilization / max : 0;
  const from = [246, 245, 243];
  const to = [197, 137, 29];
  const channel = (i: number) => Math.round(from[i] + (to[i] - from[i]) * t);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
};

// No data yet: a faint outline, recessive next to any filled cell.
const NO_DATA_STYLE = {
  backgroundColor: "transparent",
  border: "1px solid #00000012",
} as const;

type Hovered = { day: number; hour: number } | null;

export const UsageHeatmap = ({ data }: { data: HeatmapResponse }) => {
  const [hovered, setHovered] = useState<Hovered>(null);

  // Computed client-side (and refreshed each minute) so it follows the clock
  // and avoids an SSR/client hydration mismatch at the hour boundary.
  const [now, setNow] = useState<{ dow: number; hour: number } | null>(null);
  useEffect(() => {
    const update = () => setNow(currentBucket(data.timezone));
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, [data.timezone]);

  const { buckets, max } = useMemo(() => {
    const map = new Map<string, HeatmapBucket>();
    let maxUtilization = 0;
    for (const bucket of data.buckets) {
      map.set(`${bucket.dow}-${bucket.hour}`, bucket);
      maxUtilization = Math.max(maxUtilization, bucket.utilization);
    }
    return { buckets: map, max: maxUtilization };
  }, [data]);

  // Keep the tooltip inside the grid near the left/right edges.
  const tooltipAlignment = (hour: number) =>
    hour <= 3
      ? "left-0"
      : hour >= 19
        ? "right-0"
        : "left-1/2 -translate-x-1/2";

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h2 className="text-[18px] font-black">Historical usage</h2>
        {data.since && (
          <span className="text-[12px] text-[#999]">
            since {formatSince(data.since)}
          </span>
        )}
      </div>

      <div
        className="mt-4 grid gap-x-[3px] gap-y-[3px]"
        style={{ gridTemplateColumns: "auto repeat(24, minmax(0, 1fr))" }}
      >
        <div />
        {HOURS.map((hour) => (
          <div key={`now-${hour}`} className="relative h-6">
            {now?.hour === hour && (
              <div className="absolute bottom-0 left-1/2 flex -translate-x-1/2 flex-col items-center font-bold leading-none text-[#1a7f37]">
                <span className="text-[11px]">now</span>
                <span className="text-[11px]">&darr;</span>
              </div>
            )}
          </div>
        ))}

        <div />
        {HOURS.map((hour) => (
          <div
            key={`label-${hour}`}
            className="relative h-4 text-[11px] text-[#999]"
          >
            {hour % 6 === 0 && (
              <span className="absolute left-0">{formatHour(hour)}</span>
            )}
          </div>
        ))}

        {DAYS.map((dayLabel, day) => (
          <Fragment key={dayLabel}>
            <div
              className={`flex items-center pr-2 text-[12px] ${
                now?.dow === day ? "font-bold text-[#1a7f37]" : "text-[#999]"
              }`}
            >
              {dayLabel}
            </div>
            {HOURS.map((hour) => {
              const bucket = buckets.get(`${day}-${hour}`);
              const isHovered = hovered?.day === day && hovered?.hour === hour;
              const isNow = now?.dow === day && now?.hour === hour;
              const label = bucket
                ? `${Math.round(bucket.utilization * 100)}% of machines in use`
                : "no data yet";
              return (
                <div key={`${dayLabel}-${hour}`} className="relative aspect-square">
                  <button
                    type="button"
                    aria-label={`${dayLabel} ${formatHour(hour)}: ${label}${isNow ? " (now)" : ""}`}
                    className="h-full w-full cursor-default appearance-none border-none p-0 rounded-[3px]"
                    style={{
                      ...(bucket
                        ? { backgroundColor: heatColor(bucket.utilization, max) }
                        : NO_DATA_STYLE),
                      boxShadow: isHovered ? "0 0 0 2px #333" : undefined,
                    }}
                    onMouseEnter={() => setHovered({ day, hour })}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered({ day, hour })}
                    onBlur={() => setHovered(null)}
                  />
                  {isHovered && (
                    <div
                      className={`pointer-events-none absolute bottom-full z-10 mb-1.5 whitespace-nowrap rounded-md bg-[#333] px-2.5 py-1.5 text-[12px] text-white ${tooltipAlignment(hour)}`}
                    >
                      <span className="font-bold">{label}</span>
                      <span className="block text-[11px] text-[#bbb]">
                        {dayLabel} {formatHour(hour)}&ndash;
                        {formatHour((hour + 1) % 24)}
                        {isNow && <> &middot; now</>}
                        {bucket && <> &middot; {bucket.hours}h observed</>}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-end gap-1.5 text-[12px] text-[#999]">
        <span>less busy</span>
        {/* The scale is relative to the busiest cell, so the legend shows
            the fixed ramp — not data-dependent colors, which would all
            collapse to white when the busiest observed cell is idle. */}
        {[0.1, 0.3, 0.5, 0.75, 1].map((t) => (
          <span
            key={t}
            className="h-3 w-3 rounded-[3px]"
            style={{ backgroundColor: heatColor(t, 1) }}
          />
        ))}
        <span>more busy</span>
      </div>
    </div>
  );
};
