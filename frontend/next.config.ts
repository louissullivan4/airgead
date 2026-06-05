import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const nextConfig: NextConfig = {
  output: "standalone",
  // No rewrites: all backend access goes through the BFF route handlers in
  // src/app/api/* (auth/* and proxy/[...path]). A blanket /api/* rewrite would
  // shadow the dynamic proxy route and bypass the auth cookie.
};

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  // The SW is only built for production. `next dev` runs Turbopack, which the
  // Serwist webpack plugin can't hook into.
  disable: process.env.NODE_ENV === "development",
});

export default withSerwist(nextConfig);
