import React from 'react'

import { ACCENT_COLOR, ACCENT_COLOR_DARK } from '../lib/constants'

const TextLink = ({ href, children }) => {
  const onClick = () => {
    if (window.analytics && window.analytics.track) {
      window.analytics.track("Link Clicked", {
        link: href,
        text: children,
        type: "Description"
      })
    }
  }

  return (
    <React.Fragment>
      <a href={href} onClick={onClick}>{children}</a>
  
      <style jsx>{`
        a {
          color: ${ACCENT_COLOR};
          text-decoration: none;
        }
        a:hover {
          color: ${ACCENT_COLOR_DARK};
          text-decoration: underline;
        }
      `}</style>
    </React.Fragment>
  )
}

export default TextLink
