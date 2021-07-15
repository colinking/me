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
      I{"'"}m a Software Engineer at{" "}
      <TextLink href="https://airplane.dev">Airplane</TextLink>.{" "}
      <span className="small">
        (<TextLink
          href="https://careers.airplane.dev/9b0a462e4ccf4c41bf19a5b04ed6e45f"
        >
          Come work with us!
        </TextLink>)
      </span>
    </p>
    <p>
      Before Airplane, I worked at{" "}
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
      Back that, I was at <TextLink href="https://umd.edu/">UMD</TextLink>{" "}
      where I pursued a Master{"'"}s degree in Computer Science focused on
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
