import { useEffect, useState } from "react";

import { Head } from "@/components/Head";

type RedirectProps = {
  description?: string;
  image?: string;
  title: string;
  url: string;
};

export const Redirect = ({ title, description, url, image }: RedirectProps) => {
  const [showManualRedirect, setShowManualRedirect] = useState(false);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setShowManualRedirect(true);
    }, 2000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, []);

  return (
    <>
      <Head title={title} description={description} ogImage={image}>
        <meta httpEquiv="refresh" content={`0;url=${url}`} />
      </Head>

      <p
        className={`p-2 text-[#333] transition-opacity duration-150 [font-family:var(--font-inconsolata)] ${
          showManualRedirect ? "opacity-100" : "opacity-0"
        }`}
      >
        If you are not redirected automatically, click <a href={url}>here</a>
      </p>
    </>
  );
};
