import { defineConfig } from "bunup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: false,
  minify: true,
  outDir: "dist",
  packages: "bundle",
  onSuccess: () => {
    console.log("Build completed successfully!");
  },
});
