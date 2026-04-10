import Head from "./Head";
import { TEXT_COLOR } from "./lib/constants";

type RedirectProps = {
  description?: string;
  image?: string;
  title: string;
  url: string;
};

const Redirect = ({ title, description, url, image }: RedirectProps) => (
  <>
    <Head title={title} description={description} ogImage={image}>
      <meta httpEquiv="refresh" content={`0;url=${url}`} />
    </Head>

    <p>
      If you are not redirected automatically, click: <a href={url}>here</a>.
    </p>

    <style jsx>{`
      p {
        font-family: "Inconsolata", sans-serif;
        color: ${TEXT_COLOR};
      }
    `}</style>
  </>
);

export default Redirect;
