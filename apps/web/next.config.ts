import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@etherfi/contracts"],
  images: {
    minimumCacheTTL: 2_592_000,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "www.ether.fi",
        pathname: "/assets/**",
      },
    ],
  },
};

export default nextConfig;
