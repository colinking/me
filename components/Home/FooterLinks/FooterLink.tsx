import { analytics } from "@/lib/analytics";

type FooterLinkProps = {
  emoji: string;
  link: string;
  title: string;
};

export const FooterLink = ({ emoji, title, link }: FooterLinkProps) => {
  const onClick = () => {
    analytics.track("Link Clicked", {
      link,
      text: title,
      type: "Footer",
    });
  };

  return (
      <div className="mx-auto flex w-46.25 flex-row flex-nowrap justify-end text-[30px] leading-loose">
        <a
          href={link}
          onClick={onClick}
          className="text-[#337ab7] no-underline hover:underline"
        >
          {title}
          <i className={`twa twa-${emoji} ml-3.75 opacity-80`} />
        </a>
      </div>
  );
};
