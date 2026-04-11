import { Head } from "../components/Head";
import { Description } from "../components/Home/Description";
import { FooterLinks } from "../components/Home/FooterLinks/FooterLinks";
import { Video } from "../components/Home/Video";

const Home = () => (
  <div className="border-t-[5px] border-t-[#65d091]">
    <Head title="Colin King" />

    <div className="mx-auto my-25 max-w-230 px-10 text-center text-[#333] [font-family:var(--font-inconsolata)]">
      <Video src="google-fast.mp4" />
      <h1 className="mt-7.5 text-[30px] font-black">Colin King</h1>
      <div className="mb-12.5">
        <Description />
      </div>
      <FooterLinks />
    </div>
  </div>
);

export default Home;
