import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/choreo-viewer",
  trailingSlash: true,
  images: { unoptimized: true },
  outputFileTracingRoot: process.cwd(),
};

export default nextConfig;
