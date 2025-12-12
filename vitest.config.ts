import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.spec.ts"],
    exclude: ["node_modules", "dist"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      exclude: [
        "node_modules",
        "dist",
        "tests",
        "**/*.d.ts",
        "**/*.test.ts",
        "**/*.spec.ts",
        "vitest.config.ts",
        "bunup.config.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
    testTimeout: 10_000,
    hookTimeout: 10_000,
    setupFiles: ["./tests/setup.ts"],
  },
  resolve: {
    alias: {
      cenglu: "./src/index.ts",
      "cenglu/testing": "./src/testing.ts",
      "cenglu/middleware": "./src/middleware.ts",
      "cenglu/context": "./src/context.ts",
    },
  },
});
