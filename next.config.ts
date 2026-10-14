import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  experimental: {
    // Driver uploads: one BOL photo, an optional short video and its frames.
    proxyClientMaxBodySize: "50mb",
  },
};

export default nextConfig;

// Local D1, R2 and Worker vars during `next dev`.
initOpenNextCloudflareForDev();
