import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/optional-binary packages Next must not try to bundle: better-sqlite3
  // and onnxruntime load .node binaries at runtime, and transformers.js resolves
  // its backend dynamically.
  serverExternalPackages: [
    "better-sqlite3",
    "onnxruntime-node",
    "@huggingface/transformers",
  ],
  outputFileTracingRoot: process.cwd(),
  // Tracing finds onnxruntime's .node binding but not the libonnxruntime dylib
  // it dlopens at runtime, so Catch up would fail only once packaged. Pull the
  // darwin binaries in explicitly; the win32/linux ones stay excluded, which is
  // what keeps this ~35 MB instead of ~210 MB.
  outputFileTracingIncludes: {
    "/api/**": ["./node_modules/onnxruntime-node/bin/napi-v6/darwin/**"],
  },
  // The download is a 72 MB binary and used to sit in public/, where it was
  // gitignored — so a CLI deploy shipped it and a git-triggered deploy served
  // a 404 in its place. It lives on GitHub Releases now, which no deploy can
  // affect, and these keep the old URLs working. `latest` always resolves to
  // the newest release, so this never needs updating per build.
  // Rewritten rather than redirected so /api/download can count the download
  // before forwarding. A plain redirect is resolved before any code runs, which
  // made every direct link and every click from somewhere that isn't our own
  // button invisible.
  async rewrites() {
    return [
      { source: "/Sidenote.dmg", destination: "/api/download?f=dmg" },
      { source: "/Sidenote.zip", destination: "/api/download?f=zip" },
      { source: "/download", destination: "/api/download?f=dmg" },
    ];
  },
  // The Mac app bundles the server as a standalone build; normal dev/deploy
  // paths are unaffected.
  ...(process.env.SIDENOTE_STANDALONE === "1" ? { output: "standalone" as const } : {}),
};

export default nextConfig;
