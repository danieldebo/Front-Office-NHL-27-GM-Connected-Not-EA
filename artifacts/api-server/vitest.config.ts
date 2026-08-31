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
    coverage: {
      provider: "v8",
      // Only measure coverage for the pure core modules — these are the
      // ones with a 95% line-coverage gate.
      include: ["src/server/core/**"],
      exclude: ["src/server/core/**/__tests__/**"],
      thresholds: {
        lines: 95,
      },
    },
  },
  resolve: {
    conditions: ["workspace", "import", "module", "default"],
  },
});
