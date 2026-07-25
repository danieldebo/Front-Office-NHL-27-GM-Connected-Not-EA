import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Run each test file in its own isolated process to avoid ESM module
    // singleton issues (e.g. pool shared state, auth stubs).
    pool: "forks",
    // Give integration tests (real DB + concurrent requests) more time.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Resolve workspace packages by following their exports / source
    server: {
      deps: {
        // Inline workspace packages so vitest resolves their TypeScript sources
        inline: [/^@workspace\//],
      },
    },
  },
  resolve: {
    conditions: ["workspace", "import", "module", "default"],
  },
});
