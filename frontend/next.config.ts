import type { NextConfig } from "next";
import path from "path";
import withSerwistInit from "@serwist/next";

const nextConfig: NextConfig = {
  output: "standalone",
  // This app is built standalone (its own lockfile) even though it sits inside
  // an npm workspace. Pin the tracing root to this dir so Next doesn't infer the
  // monorepo root from the parent lockfile (the "multiple lockfiles" warning).
  outputFileTracingRoot: path.join(__dirname),
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
