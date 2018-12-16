import React from 'react'
import { string } from 'prop-types'

import Head from './Head'
import { TEXT_COLOR } from './lib/constants'

const Redirect = ({ url }) => (
  <React.Fragment>
    <Head>
      <meta http-equiv="refresh" content={`0;url=${url}`}/>
    </Head>

    <p>
      If you are not redirected automatically, click:{' '}
      <a href={url}>here</a>
      .
    </p>

    <style jsx>{`
      p {
        font-family: 'Inconsolata', sans-serif;
        color: ${TEXT_COLOR};
      }  
    `}</style>
  </React.Fragment>
)

Redirect.propTypes = {
  url: string
}

export default Redirect
