import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Shared package ships TS source.
  transpilePackages: ["@watchparty/shared"],
  reactStrictMode: true,
  // The dev badge sits on top of the player's play button.
  devIndicators: false,
};

export default nextConfig;
