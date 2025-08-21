#!/bin/bash

# Clean dist directory
rm -rf dist

# Build ESM
echo "Building ESM..."
npx tsc -p tsconfig.esm.json

# Rename all .js files to .mjs
for file in dist/*.js dist/**/*.js; do
  if [ -f "$file" ]; then
    mv "$file" "${file%.js}.mjs"
  fi
done

# Build CJS  
echo "Building CJS..."
npx tsc -p tsconfig.cjs.json

# Rename all .js files to .cjs
for file in dist/*.js dist/**/*.js; do
  if [ -f "$file" ]; then
    mv "$file" "${file%.js}.cjs"
  fi
done

echo "Build complete!"