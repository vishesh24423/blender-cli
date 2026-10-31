import type { NextConfig } from "next";

// R2 public buckets send no CORS headers, and model-viewer fetches the GLB
// with fetch(), so cross-origin loading fails. Proxy the bucket through this
// origin instead — same-origin requests skip CORS entirely.
const R2_PUBLIC_ORIGIN = "https://pub-c433f0573ec94b6eb287f9d1dd68ba3b.r2.dev";

const nextConfig: NextConfig = {
  /* config options here */

  serverExternalPackages: ['firebase-admin'],

  async rewrites() {
    return [
      { source: "/r2/:path*", destination: `${R2_PUBLIC_ORIGIN}/:path*` },
    ];
  },
};

export default nextConfig;

