import { defineConfig } from "bunup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/context.ts",
    "src/testing.ts",
    "src/middleware.ts",
    "src/format.ts",
    "src/redaction.ts",
    "src/plugins/index.ts",
    "src/transports/index.ts",
  ],
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  minify: false,
  outDir: "dist",
  packages: "bundle",
  external: [
    "node:fs",
    "node:path",
    "node:zlib",
    "node:async_hooks",
    "node:events",
    "node:crypto",
    "node:http",
    "node:os",
    "node:stream",
    "node:stream/promises",
    "node:child_process",
  ],
  onSuccess: () => {
    console.log("Build completed successfully!");
  },
});
