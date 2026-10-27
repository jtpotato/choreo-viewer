import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: "/choreo-viewer",
  trailingSlash: true,
  images: { unoptimized: true },
  outputFileTracingRoot: process.cwd(),
};

export default nextConfig;
