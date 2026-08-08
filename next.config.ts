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
  async redirects() {
    const asset = (name: string) =>
      `https://github.com/doranalytics/sidenote/releases/latest/download/${name}`;
    return [
      { source: "/Sidenote.dmg", destination: asset("Sidenote.dmg"), permanent: false },
      { source: "/Sidenote.zip", destination: asset("Sidenote.zip"), permanent: false },
      { source: "/download", destination: asset("Sidenote.dmg"), permanent: false },
    ];
  },
  // The Mac app bundles the server as a standalone build; normal dev/deploy
  // paths are unaffected.
  ...(process.env.SIDENOTE_STANDALONE === "1" ? { output: "standalone" as const } : {}),
};

export default nextConfig;
