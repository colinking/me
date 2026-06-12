import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { Inconsolata } from "next/font/google";
import type { AppProps } from "next/app";
import { useRouter } from "next/router";
import { useEffect } from "react";
import { analytics } from "@/lib/analytics";

import "@/styles/globals.css";
import "@/styles/twemoji-awesome.css";

const inconsolata = Inconsolata({
  subsets: ["latin"],
  variable: "--font-inconsolata",
  weight: ["400", "700"],
});

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();

  // Every page is a full document load today, so the mount call alone would
  // cover the whole site; the route-change listener keeps page views correct
  // if client-side navigation (next/link) is ever introduced.
  useEffect(() => {
    analytics.page();
    const onRouteChange = () => analytics.page();
    router.events.on("routeChangeComplete", onRouteChange);
    return () => router.events.off("routeChangeComplete", onRouteChange);
  }, [router.events]);

  return (
    <div className={inconsolata.variable}>
      <Component {...pageProps} />
      <Analytics />
      <SpeedInsights />
    </div>
  );
}
