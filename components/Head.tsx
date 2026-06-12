import NextHead from "next/head";
import type { ReactNode } from "react";

const defaultOGTitle = "Colin King";
const defaultDescription = "software engineer · platform & infrastructure";
const defaultOGURL = "https://colinking.co";
const defaultOGImage = "https://colinking.co/og.png";

type HeadProps = {
  children?: ReactNode;
  description?: string;
  favicon?: string;
  ogImage?: string;
  title?: string;
  url?: string;
};

export const Head = ({
  children,
  description,
  favicon = "/favicon.png",
  ogImage,
  title,
  url,
}: HeadProps) => (
  <NextHead>
    <meta charSet="UTF-8" />
    <title>{title || ""}</title>
    <meta name="description" content={description || defaultDescription} />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" type="image/png" href={favicon} />
    <link rel="apple-touch-icon" href={favicon} />
    <meta property="og:url" content={url || defaultOGURL} />
    <meta property="og:title" content={title || defaultOGTitle} />
    <meta property="og:description" content={description || defaultDescription} />
    <meta name="twitter:site" content={url || defaultOGURL} />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content={ogImage || defaultOGImage} />
    <meta property="og:image" content={ogImage || defaultOGImage} />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="theme-color" content="#ffffff" />

    {children}
  </NextHead>
);
