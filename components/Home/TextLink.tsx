import { ACCENT_COLOR, ACCENT_COLOR_DARK } from "../lib/constants";

type TextLinkProps = {
  children: string;
  href: string;
};

const TextLink = ({ href, children }: TextLinkProps) => {
  const onClick = () => {
    if (window.analytics?.track) {
      window.analytics.track("Link Clicked", {
        link: href,
        text: children,
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
