import React from "react";
import NextHead from "next/head";
import { string } from "prop-types";
import snippet from "@segment/snippet";

const segment = snippet.min({
  apiKey: "KdZKMvdBedsuBs0X6ZfJ5fjxbqcm2SlC",
});

import { TEXT_SIZE } from "./lib/constants";

const defaultOGTitle = "Colin King";
const defaultDescription = "Colin King: Eng @Segment, KP Eng Fellow";
const defaultOGURL = "https://colinking.co";
const defaultOGImage = "profile.png";

const Head = (props) => (
  <NextHead>
    <meta charSet="UTF-8" />
    <title>{props.title || ""}</title>
    <meta
      name="description"
      content={props.description || defaultDescription}
    />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" href="/favicon.ico" />
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
    <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
    <link rel="shortcut icon" href="/favicon.ico" />
    <link rel="manifest" href="/site.webmanifest" />
    <meta property="og:url" content={props.url || defaultOGURL} />
    <meta property="og:title" content={props.title || defaultOGTitle} />
    <meta
      property="og:description"
      content={props.description || defaultDescription}
    />
    <meta name="twitter:site" content={props.url || defaultOGURL} />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content={props.ogImage || defaultOGImage} />
    <meta property="og:image" content={props.ogImage || defaultOGImage} />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="msapplication-TileColor" content="#da532c" />
    <meta name="msapplication-config" content="/browserconfig.xml" />
    <meta name="theme-color" content="#ffffff" />

    <link
      rel="stylesheet"
      href="https://fonts.googleapis.com/css?family=Inconsolata:400,700&display=block"
    />
    <link
      rel="preload"
      href="/twemoji-awesome.css"
      as="style"
      onLoad="this.rel='stylesheet'"
    />

    <script dangerouslySetInnerHTML={{ __html: segment }} />

    {props.children}
  </NextHead>
);

Head.propTypes = {
  title: string,
  description: string,
  url: string,
  ogImage: string,
};

export default Head;
