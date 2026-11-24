import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.ZENITH_PREVIEW_BUILD === "1" ? ".next-preview" : ".next",
  allowedDevOrigins: ["127.0.0.1"],
  reactStrictMode: true,
  output: "standalone",
  serverExternalPackages: ["jsonld", "rdf-canonize", "ajv", "ajv-formats"],
  outputFileTracingIncludes: {
    "/*": ["./cms/**/*", "./src/lib/catalog/*.mjs", "./profiles/catalog/**/*", "./profiles/setup/component-contracts.json", "./profiles/process-macos/release.v1.json"],
    "/api/hub/inspections": ["./profiles/application-db/**/*", "./profiles/setup/**/*", "./profiles/object-store/**/*", "./src/lib/application/*.mjs", "./src/lib/objects/codec-worker.mjs"],
    "/api/hub/inventory": ["./profiles/application-db/**/*", "./profiles/setup/**/*", "./profiles/object-store/**/*", "./src/lib/application/*.mjs", "./src/lib/objects/codec-worker.mjs"],
    "/api/database": ["./profiles/application-db/**/*", "./profiles/object-store/**/*", "./src/lib/objects/codec-worker.mjs"],
    "/api/objects": ["./profiles/application-db/**/*", "./profiles/object-store/**/*", "./src/lib/objects/codec-worker.mjs"],
    "/api/hub": ["./profiles/application-db/**/*","./profiles/setup/**/*", "./scripts/setup/**/*", "./src/lib/setup/*.mjs", "./profiles/object-store/**/*", "./src/lib/objects/codec-worker.mjs"],
    "/api/setup": [
      "./src/lib/application/*.mjs",
      "./profiles/application-db/**/*",
      "./profiles/setup/**/*",
      "./scripts/setup/**/*",
      "./src/lib/setup/*.mjs",
      "./profiles/object-store/**/*",
      "./src/lib/objects/codec-worker.mjs",
      "./profiles/process-macos/**/*",
    ],
  },
  outputFileTracingExcludes: {
    "/*": [
      "./.next-preview/**",
      "./docs/guided-setup/evidence/**",
      "./.native-sources/**",
      "./.native-npm-cache/**",
      "./profiles/*/context/**",
    ],
  },
  // This small local operator builds on the same Mac as its native services.
  experimental: { cpus: 1 },
};

export default nextConfig;
