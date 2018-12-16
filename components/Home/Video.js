import React from 'react'

import { TEXT_COLOR } from '../lib/constants'

const Gif = ({ src }) => (
  <React.Fragment>
    <video autoPlay loop muted playsInline>
      <source src={src} type="video/mp4" />
    </video>

    <style jsx>{`
      video {
        border: 2px solid ${TEXT_COLOR};
        height: 290px;
        border-radius: 20px;
        width: 218px;
        margin: 0;
        padding: 0;
        display: block;
        margin: auto;
      }
    `}</style>
  </React.Fragment>
)

export default Gif
