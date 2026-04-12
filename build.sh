#!/bin/bash
# Build and bundle with esbuild

# Type check first
npx tsc --noEmit
if [ $? -ne 0 ]; then
  echo "Type check failed"
  exit 1
fi

# Compile TypeScript and bundle to single file
npx esbuild src/app.ts --bundle --outfile=dist/bundle.js --format=iife

echo "Build complete: dist/bundle.js"