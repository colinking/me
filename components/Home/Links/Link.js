import React from 'react'
import { string } from 'prop-types'

import { SUB_TEXT_SIZE, SECONDARY_ACCENT_COLOR, SECONDARY_ACCENT_COLOR_DARK } from '../../lib/constants'

const Link = ({ emoji, title, link }) => (
  <React.Fragment>
    <div className="link">
      <a href={link}>
        {title}
      </a>
      <a href={link}>
        <i className={`twa twa-${emoji}`} />
      </a>
    </div>

    <style jsx>{`
      .link {
        display: flex;
        flex-direction: row;
        flex-wrap: nowrap;
        justify-content: flex-end;

        font-size: ${SUB_TEXT_SIZE};
        margin: auto;
        line-height: 2;
        width: 160px;
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
  </React.Fragment>
)

Link.propTypes = {
  emoji: string,
  title: string,
  link: string
}

export default Link
