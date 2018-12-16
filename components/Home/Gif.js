import React from 'react'

import { BP_MEDIUM_TO_LARGE } from '../lib/constants'

const Gif = ({ src }) => (
  <React.Fragment>
    <img src={src}/>

    <style jsx>{`
      img {
        border: 1px solid #444;
        max-height: 300px;
      }

      @media (min-width: ${BP_MEDIUM_TO_LARGE + 1 + "px"}) {
        img {
          border-radius: 20px;
          max-width: 300px;
        }
      }
      @media (max-width: ${BP_MEDIUM_TO_LARGE + "px"}) {
        img {
          border-radius: 15px;
          max-width: 200px;
        }
      }
    `}</style>
  </React.Fragment>
)

export default Gif
