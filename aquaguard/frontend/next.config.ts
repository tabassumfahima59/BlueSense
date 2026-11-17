import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The e2e run builds into its own folder so the regular build (.next) is never overwritten.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
