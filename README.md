## colinking.co

The codebase for my personal website: [colinking.co](https://colinking.co)

## Local Development

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

If you want Segment enabled locally, run `npx vercel env pull .env.local`.

Create a production build:

```bash
npm run build
```

Run the production server locally after building:

```bash
npm run start
```

## Resume

This website serves my resume. This repo contains the the LaTeX code to generate it.


```bash
brew install tectonic
tectonic resume/resume.tex --outdir ./public
```

This writes the output PDF to `resume/resume.pdf`.

## Deployment

This website is automatically deployed via Vercel.

## Resources

### Twitter Emojis

By [@ellekasai](https://github.com/ellekasai), available at [ellekasai.github.io/twemoji-awesome](http://ellekasai.github.io/twemoji-awesome/).

### Font

Font ([Inconsolata](https://fonts.google.com/specimen/Inconsolata)) inspired by [jhil.co](http://jhil.co).
