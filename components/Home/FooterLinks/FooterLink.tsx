import {
  SECONDARY_ACCENT_COLOR,
  SECONDARY_ACCENT_COLOR_DARK,
  TEXT_SIZE,
} from "../../lib/constants";

type FooterLinkProps = {
  emoji: string;
  link: string;
  title: string;
};

const FooterLink = ({ emoji, title, link }: FooterLinkProps) => {
  const onClick = () => {
    if (window.analytics?.track) {
      window.analytics.track("Link Clicked", {
        link,
        text: title,
        type: "Footer",
      });
    }
  };

  return (
    <>
      <div className="link">
        <a href={link} onClick={onClick}>
          {title}
          <i className={`twa twa-${emoji}`} />
        </a>
      </div>

      <style jsx>{`
        .link {
          display: flex;
          flex-direction: row;
          flex-wrap: nowrap;
          justify-content: flex-end;

          font-size: ${TEXT_SIZE};
          margin: auto;
          line-height: 2;
          width: 185px;
        }
        a {
          text-decoration: none;
          color: ${SECONDARY_ACCENT_COLOR};
        }
        i {
          opacity: 0.8;
          margin-left: 15px;
        }
        p {
          color: ${SECONDARY_ACCENT_COLOR};
          opacity: 0.8;
        }
        a:hover {
          color: ${SECONDARY_ACCENT_COLOR_DARK};
          text-decoration: underline;
        }
      `}</style>
    </>
  );
};

export default FooterLink;
