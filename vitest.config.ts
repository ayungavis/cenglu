import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json"],
      exclude: ["node_modules/", "dist/", "*.config.ts", "*.config.js"],
    },
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
});
