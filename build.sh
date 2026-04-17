#!/bin/bash
# Build and bundle with esbuild

# Type check first
npx tsc --noEmit
if [ $? -ne 0 ]; then
  echo "Type check failed"
  exit 1
fi

# Compile TypeScript and bundle to single file
# Use platform-specific esbuild
if [ -f "node_modules/@esbuild/win32-x64/esbuild.exe" ]; then
  node_modules/@esbuild/win32-x64/esbuild.exe src/app.ts --bundle --outfile=dist/bundle.js --format=iife
elif [ -f "node_modules/@esbuild/linux-x64/esbuild" ]; then
  node_modules/@esbuild/linux-x64/esbuild src/app.ts --bundle --outfile=dist/bundle.js --format=iife
else
  npx esbuild src/app.ts --bundle --outfile=dist/bundle.js --format=iife
fi
if [ $? -ne 0 ]; then
  echo "Build failed"
  exit 1
fi

echo "Build complete: dist/bundle.js"