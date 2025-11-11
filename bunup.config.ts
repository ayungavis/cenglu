import { defineConfig } from "bunup";

export default defineConfig({
  entry: [
    "./src/index.ts",
    "./src/adapters/hono.ts",
    "./src/adapters/nest.ts",
    "./src/adapters/express.ts",
    "./src/adapters/drizzle.ts",
  ],
  format: ["cjs", "esm"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: true,
});
