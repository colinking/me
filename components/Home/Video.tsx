type VideoProps = {
  src: string;
};

export const Video = ({ src }: VideoProps) => (
  <video
    autoPlay
    loop
    muted
    playsInline
    className="mx-auto block h-72.5 w-54.5 rounded-[20px] border-2 border-[#333] p-0"
  >
      <source src={src} type="video/mp4" />
  </video>
);
