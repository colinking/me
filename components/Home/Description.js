import React from 'react'

import TextLink from './TextLink'
import { TEXT_SIZE, BP_MEDIUM_TO_LARGE, ACCENT_COLOR, ACCENT_COLOR_DARK } from '../lib/constants';

const Description = ({ src }) => (
  <React.Fragment>
    <p>
      I'm a Software Engineer at{' '}
      <TextLink href="https://segment.com">Segment</TextLink>
      {' '}working on infrastructure services. Before that, I worked on{' '}
      <TextLink href="https://segment.com/product/protocols">Protocols</TextLink>
      {' '}and{' '}
      <TextLink href="https://github.com/segmentio/typewriter">Typewriter</TextLink>
      .
    </p>
    <p>
      Before Segment, I was a Venture Partner at{' '}
      <TextLink href="http://contrarycap.com/">Contrary Capital</TextLink>
      , where I ran the{' '}
      <TextLink href="https://www.umd.edu/">University of Maryland</TextLink>
      {' '}community. I also bootstrapped the branding and engineering teams at Contrary.
    </p>
    <p>
      I was also a{' '}
      <TextLink href="http://kpcbfellows.com/">Kleiner Perkins Engineering Fellow</TextLink>
      {' '}on the infrastructure team at{' '}
      <TextLink href="https://nextdoor.com/about/">Nextdoor</TextLink>
      . Before that, I was a SWE intern at Google on{' '}
      <TextLink href="https://cloud.google.com/appengine/training/fts_intro/">App Engine Search</TextLink>
      .
    </p>
    <p>
      I founded and taught{' '}
      <TextLink href="http://ter.ps/pccS18">CMSC389L</TextLink>
      , Practical Cloud Computing with AWS, during the {' '}
      <TextLink href="http://ter.ps/cmsc389l">Fall 2017</TextLink>
      {' '}and{' '}
      <TextLink href="http://ter.ps/pccS18">Spring 2018</TextLink>
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
    `}</style>
  </React.Fragment>
)

export default Description
