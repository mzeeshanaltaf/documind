import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import type { NextConfig } from "next";

// Single source of env: the repo-root .env.local (shared with api/).
// Loaded by hand rather than with @next/env's loadEnvConfig: Next has already
// loaded (and cached) env for web/ by the time this runs, so a second
// loadEnvConfig call is a silent no-op, and forcing a reload swaps process.env
// wholesale, which makes `next dev` restart the client on every connection.
// Real environment variables win over the file, as with dotenv.
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
