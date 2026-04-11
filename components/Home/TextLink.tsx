type TextLinkProps = {
  children: string;
  href: string;
};

export const TextLink = ({ href, children }: TextLinkProps) => {
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
      <a
        href={href}
        onClick={onClick}
        className="text-[#65d091] no-underline hover:text-[#51a774] hover:underline"
      >
        {children}
      </a>
  );
};
