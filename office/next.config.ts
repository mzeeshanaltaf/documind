import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import type { NextConfig } from "next";

// Single source of env: the repo-root .env.local (shared with DocuMind and Evaluation).
// Loaded by hand, as in web/next.config.ts: Next has already loaded (and cached) env for this
// folder, so a second loadEnvConfig call is a silent no-op, and forcing a reload makes
// `next dev` restart endlessly. Real environment variables win over the file.
const rootEnv = path.resolve(__dirname, "..", ".env.local");
if (fs.existsSync(rootEnv)) {
  for (const [key, value] of Object.entries(parseEnv(fs.readFileSync(rootEnv, "utf8")))) {
    process.env[key] ??= value;
  }
}

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["pg"],
  cacheComponents: true,
  partialPrefetching: true,
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
