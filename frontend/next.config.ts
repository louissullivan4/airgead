import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // No rewrites: all backend access goes through the BFF route handlers in
  // src/app/api/* (auth/* and proxy/[...path]). A blanket /api/* rewrite would
  // shadow the dynamic proxy route and bypass the auth cookie.
};

export default nextConfig;
