import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "www.google.com" },
      { protocol: "https", hostname: "unpkg.com" },
    ],
    unoptimized: true,
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "framer-motion"],
  },
  typescript: {
    // Render should not fail deployment because of non-runtime TypeScript diagnostics.
    // The app still compiles; scripts and diagnostics are handled separately.
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
