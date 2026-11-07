import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  skipTrailingSlashRedirect: true,
  outputFileTracingRoot: path.join(__dirname),
  typescript: {
    tsconfigPath: "tsconfig.next.json",
  },
};

export default nextConfig;
