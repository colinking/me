// The wash backend lives in a Cloudflare Worker (workers/wash). Local dev
// talks to `wrangler dev` on 8787; production must set WASH_API_ORIGIN to
// the deployed worker URL (e.g. https://wash.<account>.workers.dev) —
// without it, /wash/api/* will fail.
const washApiOrigin = process.env.WASH_API_ORIGIN ?? "http://localhost:8787";

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: "/wash/api/:path*",
        destination: `${washApiOrigin}/:path*`,
      },
    ];
  },
};

export default nextConfig;
