import { SpeedInsights } from '@vercel/speed-insights/next';
import { Inconsolata } from "next/font/google";
import type { AppProps } from "next/app";

import "@/styles/globals.css";
import "@/styles/twemoji-awesome.css";

const inconsolata = Inconsolata({
  subsets: ["latin"],
  variable: "--font-inconsolata",
  weight: ["400", "700"],
});

export default function App({ Component, pageProps }: AppProps) {
  return (
    <div className={inconsolata.variable}>
      <Component {...pageProps} />
      <SpeedInsights />
    </div>
  );
}
