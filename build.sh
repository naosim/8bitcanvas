#!/bin/bash
# Build and bundle with esbuild

# Compile TypeScript and bundle to single file
npx esbuild src/app.ts --bundle --outfile=dist/bundle.js --format=iife

echo "Build complete: dist/bundle.js"