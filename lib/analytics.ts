import { AnalyticsBrowser } from "@segment/analytics-next";

const writeKey = process.env.NEXT_PUBLIC_SEGMENT_WRITE_KEY;

export const analytics =
  typeof window !== "undefined" && writeKey
    ? AnalyticsBrowser.load({ writeKey })
    : new AnalyticsBrowser();
