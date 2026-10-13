import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Driver uploads carry a POD photo, a signature, a short video and its frames.
    proxyClientMaxBodySize: "60mb",
  },
};

export default nextConfig;
