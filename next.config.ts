import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  env: {
    SAM_GOV_API_KEY: process.env.SAM_GOV_API_KEY,
  },
};

export default nextConfig;
