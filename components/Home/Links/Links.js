import React from 'react'

import Link from './Link';

const Links = () => (
  <React.Fragment>
    <div id="link-container">
      <Link emoji="books" title="Goodreads" link="https://www.goodreads.com/user/show/40155956-colin-king" />
      <Link emoji="briefcase" title="LinkedIn" link="https://www.linkedin.com/in/colinking1/" />
      <Link emoji="computer" title="GitHub" link="https://github.com/colinking" />
      <Link emoji="bicyclist" title="Strava" link="https://www.strava.com/athletes/9159854" />
      <Link emoji="page-facing-up" title="Resume" link="/resume" />
      <Link emoji="writing-hand" title="Medium" link="https://medium.com/@colinking" />
      <Link emoji="email" title="Email" link="mailto:me@colinking.co" />
      <Link emoji="bird" title="Twitter" link="https://twitter.com/maydayitscolink" />
      <Link emoji="key" title="Keybase" link="https://keybase.io/colinking" />
    </div>

    <style jsx>{`
      #link-container {
        flex: row;
        flex-wrap: wrap;
        justify-content: center;
      }
    `}</style>
  </React.Fragment>
)

export default Links
