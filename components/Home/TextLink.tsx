import type { ReactNode } from "react";

import { ACCENT_COLOR, ACCENT_COLOR_DARK } from "../lib/constants";

type TextLinkProps = {
  children: ReactNode;
  href: string;
};

const TextLink = ({ href, children }: TextLinkProps) => {
  const analyticsText =
    typeof children === "string" || typeof children === "number"
      ? String(children)
      : undefined;

  const onClick = () => {
    if (window.analytics?.track) {
      window.analytics.track("Link Clicked", {
        link: href,
        text: analyticsText,
        type: "Description",
      });
    }
  };

  return (
    <>
      <a href={href} onClick={onClick}>
        {children}
      </a>

      <style jsx>{`
        a {
          color: ${ACCENT_COLOR};
          text-decoration: none;
        }
        a:hover {
          color: ${ACCENT_COLOR_DARK};
          text-decoration: underline;
        }
      `}</style>
    </>
  );
};

export default TextLink;
