import React from "react";

import TextLink from "./TextLink";
import {
  ACCENT_COLOR,
  ACCENT_COLOR_DARK,
  BP_MEDIUM_TO_LARGE,
  SUB_TEXT_SIZE,
  TEXT_SIZE,
} from "../lib/constants";

const Description = ({ src }) => (
  <React.Fragment>
    <p>
      I{"'"}m a software engineer interested in new tech primitives.
      I'm working on better scripting infrastructure with the{" "}<TextLink
          href="https://www.airplane.dev/careers"
        >
          amazing folks
        </TextLink> at{" "}
      <TextLink href="https://airplane.dev">Airplane</TextLink>.{" "}
    </p>
    <p>
      Previously, I worked at{" "}
      <TextLink href="https://segment.com">Segment</TextLink>{" "}
      on infrastructure services. I also worked on{"   "}
      <TextLink href="https://segment.com/product/protocols">
        Protocols
      </TextLink>{" "}
      and{" "}
      <TextLink href="https://github.com/segmentio/typewriter">
        Typewriter
      </TextLink>
      .
    </p>
    <p>
      Before that, I was at <TextLink href="https://umd.edu/">UMD</TextLink>{" "}
      where I pursued a Master{"'"}s in Computer Science with a focus on
      distributed systems. I also created the course{" "}
      <TextLink href="http://ter.ps/pccS18">
        Practical Cloud Computing with AWS
      </TextLink>{" "}
      and taught it twice (
      <TextLink href="https://ter.ps/cmsc389l">Fall</TextLink> and{" "}
      <TextLink href="https://ter.ps/pccS18">Spring</TextLink>).
    </p>

    <style jsx>
      {`
      p {
        text-align: left;
        margin-bottom: 25px;
        font-size: ${TEXT_SIZE};
        font-weight: 400;
        line-height: 1.42;
      }
      .small {
        font-size: ${SUB_TEXT_SIZE}
      }
    `}
    </style>
  </React.Fragment>
);

export default Description;
