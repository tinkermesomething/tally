import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // A CSV import sends the whole parsed file in one request (up to 20,000
  // rows); the 1MB default would reject a long statement.
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
};

export default nextConfig;
