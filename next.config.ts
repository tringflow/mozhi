import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the project root. A stray package-lock.json in a parent folder otherwise makes Next
  // guess the wrong workspace root (and warn), which also affects production file tracing.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
