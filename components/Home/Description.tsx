import { TextLink } from "@/components/Home/TextLink";

export const Description = () => (
  <div className="text-left text-[30px] font-normal leading-[1.42]">
    <p>
      I'm a software engineer focused on building platform and infrastructure services.
    </p>
    <p>
      Most recently, I worked at <TextLink href="https://www.rippling.com/">Rippling</TextLink>{" "}
      where I started the Search team and supported various platform teams.
    </p>
    <p>
      Before that, I was the first hire at{" "}
      <TextLink href="https://web.archive.org/web/20240104001239/https://www.airplane.dev">Airplane</TextLink>{" "}
      where we built an internal tooling platform for developers{" "}
      (<TextLink href="https://web.archive.org/web/20240104001239/https://www.airplane.dev/blog/airtable">acquired by Airtable</TextLink>).
      I also worked at{" "}
      <TextLink href="https://segment.com">Segment</TextLink> on{" "}
      <TextLink href="https://segment.com/product/protocols">Protocols</TextLink>,{" "}
      <TextLink href="https://github.com/segmentio/typewriter">Typewriter</TextLink>,{" "}
      and various platform systems.
    </p>
    <p>
      Before that, I studied at the <TextLink href="https://umd.edu/">University of Maryland</TextLink>{" "}
      where I pursued a Master{"'"}s in Computer Science with a focus on
      distributed systems. I also created the course{" "}
      <TextLink href="http://ter.ps/pccS18">
        Practical Cloud Computing with AWS
      </TextLink>{" "}
      and taught it twice (<TextLink href="https://ter.ps/cmsc389l">Fall</TextLink>{" "}
      and <TextLink href="https://ter.ps/pccS18">Spring</TextLink>).
    </p>
  </div>
);
