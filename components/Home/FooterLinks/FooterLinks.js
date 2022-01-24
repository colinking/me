import React from 'react'

import FooterLink from './FooterLink';

const FooterLinks = () => (
  <React.Fragment>
    <div id="link-container">
      <FooterLink emoji="writing-hand" title="Blog (1)" link="https://colinking.substack.com" />
      <FooterLink emoji="bird" title="Twitter" link="https://twitter.com/maydayitscolink" />
      <FooterLink emoji="computer" title="GitHub" link="https://github.com/colinking" />
      <FooterLink emoji="briefcase" title="LinkedIn" link="https://www.linkedin.com/in/colinking1/" />
      <FooterLink emoji="page-facing-up" title="Resume" link="/resume" />
      <FooterLink emoji="email" title="Email" link="mailto:me@colinking.co" />
      <FooterLink emoji="books" title="Goodreads" link="https://www.goodreads.com/colinking" />
      <FooterLink emoji="bicyclist" title="Strava" link="https://www.strava.com/athletes/9159854" />
      <FooterLink emoji="key" title="Keybase" link="https://keybase.io/colinking" />
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

export default FooterLinks
