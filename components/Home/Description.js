import React from 'react'

import { TEXT_SIZE, BP_MEDIUM_TO_LARGE, ACCENT_COLOR, ACCENT_COLOR_DARK } from '../lib/constants';

const Description = ({ src }) => (
  <React.Fragment>
    <p>
      I'm a Software Engineer at{' '}
      <a href="https://segment.com">Segment</a>
      {' '}on the{' '}
      <a href="https://segment.com/product/protocols">Protocols</a>
      {' '}team where I also maintain{' '}
      <a href="https://github.com/segmentio/typewriter">Typewriter</a>
      .
    </p>
    <p>
      Before that, I was a Venture Partner at{' '}
      <a href="http://contrarycap.com/">Contrary Capital</a>
      , where I ran the{' '}
      <a href="https://www.umd.edu/">University of Maryland</a>
      {' '}community. I also founded and run their branding and engineering teams.
    </p>
    <p>
      I was also a{' '}
      <a href="http://kpcbfellows.com/">Kleiner Perkins Engineering Fellow</a>
      {' '}on the infrastructure team at{' '}
      <a href="https://nextdoor.com/about/">Nextdoor</a>
      . Before that, I was a SWE intern at Google on{' '}
      <a href="https://cloud.google.com/appengine/training/fts_intro/">App Engine Search</a>
      .
    </p>
    <p>
      I founded and taught{' '}
      <a href="http://ter.ps/pccS18">CMSC389L</a>
      , Practical Cloud Computing with AWS, during the {' '}
      <a href="http://ter.ps/cmsc389l">Fall 2017</a>
      {' '}and{' '}
      <a href="http://ter.ps/pccS18">Spring 2018</a>
      {' '}semesters at UMD.
    </p>
    <p>
      I also pursued a Master's degree in Computer Science at UMD where I focused on security and distributed systems.
    </p>

    <style jsx>{`
      p {
        text-align: left;
        margin-bottom: 25px;
        font-size: ${TEXT_SIZE};
        font-weight: 400;
        line-height: 1.42;
      }
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

export default Description
