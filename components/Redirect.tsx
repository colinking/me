import { Head } from "@/components/Head";

type RedirectProps = {
  description?: string;
  image?: string;
  title: string;
  url: string;
};

export const Redirect = ({ title, description, url, image }: RedirectProps) => (
  <>
    <Head title={title} description={description} ogImage={image}>
      <meta httpEquiv="refresh" content={`0;url=${url}`} />
    </Head>

    <p className="p-2 text-[#333] [font-family:var(--font-inconsolata)]">
      If you are not redirected automatically, click: <a href={url}>here</a>.
    </p>
  </>
);
