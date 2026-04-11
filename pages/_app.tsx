import { SpeedInsights } from '@vercel/speed-insights/next';
import type { AppProps } from "next/app";

import "../styles/globals.css";
import "../styles/twemoji-awesome.css";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Component {...pageProps} />
      <SpeedInsights />
    </>
  );
}
