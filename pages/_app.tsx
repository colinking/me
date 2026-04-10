import type { AppProps } from "next/app";

import "../styles/twemoji-awesome.css";

export default function App({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}
