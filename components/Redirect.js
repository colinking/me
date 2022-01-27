import React from "react";
import { string } from "prop-types";

import Head from "./Head";
import { TEXT_COLOR } from "./lib/constants";

const Redirect = ({ title, description, url }) => (
  <React.Fragment>
    <Head title={title} description={description}>
      <meta httpEquiv="refresh" content={`0;url=${url}`} />
    </Head>

    <p>
      If you are not redirected automatically, click: <a href={url}>here</a>
      .
    </p>

    <style jsx>
      {`
      p {
        font-family: 'Inconsolata', sans-serif;
        color: ${TEXT_COLOR};
      }  
    `}
    </style>
  </React.Fragment>
);

Redirect.propTypes = {
  title: string,
  url: string,
};

export default Redirect;
