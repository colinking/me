const Resume = () => (
  <div>
    <iframe
      src="https://drive.google.com/file/d/0BwpZPtPt9scANW1iYWFKSlRMT0k/preview"
      title="Colin King's resume"
    />

    <style jsx>{`
      :global(body) {
        margin: 0;
      }
      iframe {
        width: 100vw;
        height: 100vh;
        border: none;
      }
    `}</style>
  </div>
)

export default Resume
