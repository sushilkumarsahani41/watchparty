import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";

const nextConfig: NextConfig = {
  // Production is a static site (Cloudflare Workers static assets). /room/<code> is served by the single
  // static /room page: the host rewrites it (public/_redirects); in dev the rewrite below does the same.
  ...(dev
    ? { rewrites: async () => [{ source: "/room/:roomId", destination: "/room" }] }
    : { output: "export" as const }),
  // Shared package ships TS source.
  transpilePackages: ["@watchparty/shared"],
  reactStrictMode: true,
  // The dev badge sits on top of the player's play button.
  devIndicators: false,
};

export default nextConfig;
