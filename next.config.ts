import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: "/choreo-viewer",
  images: { unoptimized: true },
  outputFileTracingRoot: process.cwd(),
};

export default nextConfig;
