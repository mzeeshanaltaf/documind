import path from "node:path";
import { defineConfig } from "vitest/config";

// Pure logic runs in node; component tests are named *.dom.test.tsx and get jsdom.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // `server-only` throws outside a react-server bundle; tests import server modules directly.
      "server-only": path.resolve(import.meta.dirname, "tests/server-only-stub.ts"),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["src/**/*.dom.test.tsx", "tests/**/*.dom.test.tsx"],
        },
      },
    ],
  },
});
