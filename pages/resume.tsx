import { Head } from "@/components/Head";

const Resume = () => (
  <>
    <Head title="Resume — Colin King" />
    <embed
      src="/resume.pdf"
      type="application/pdf"
      title="Colin King's resume"
      className="h-screen w-screen"
    />
  </>
);

export default Resume;
