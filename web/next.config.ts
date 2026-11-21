import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Shared package ships TS source.
  transpilePackages: ["@watchparty/shared"],
  reactStrictMode: true,
};

export default nextConfig;
