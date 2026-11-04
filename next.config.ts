import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // The in-memory place store (used when no DATABASE_URL is set) seeds itself from content/ at runtime.
  outputFileTracingIncludes: { "/map": ["./content/**/*"] },
  partialPrefetching: true,
  async headers() {
    return [
      {
        // Self-hosted video thumbnails: filenames carry a content hash, so they never change in place.
        source: "/social/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
