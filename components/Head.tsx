import NextHead from "next/head";
import type { ReactNode } from "react";

const defaultOGTitle = "Colin King";
const defaultDescription = "eng @ airplane.dev";
const defaultOGURL = "https://colinking.co";
const defaultOGImage = "/profile.png#1";

type HeadProps = {
  children?: ReactNode;
  description?: string;
  ogImage?: string;
  title?: string;
  url?: string;
};

export const Head = ({
  children,
  description,
  ogImage,
  title,
  url,
}: HeadProps) => (
  <NextHead>
    <meta charSet="UTF-8" />
    <title>{title || ""}</title>
    <meta name="description" content={description || defaultDescription} />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" href="/favicon.ico" />
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
    <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
    <link rel="shortcut icon" href="/favicon.ico" />
    <link rel="manifest" href="/site.webmanifest" />
    <meta property="og:url" content={url || defaultOGURL} />
    <meta property="og:title" content={title || defaultOGTitle} />
    <meta property="og:description" content={description || defaultDescription} />
    <meta name="twitter:site" content={url || defaultOGURL} />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content={ogImage || defaultOGImage} />
    <meta property="og:image" content={ogImage || defaultOGImage} />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="msapplication-TileColor" content="#da532c" />
    <meta name="msapplication-config" content="/browserconfig.xml" />
    <meta name="theme-color" content="#ffffff" />

    {children}
  </NextHead>
);
