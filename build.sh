#!/usr/bin/env bash
# Package MonkGrab for the Chrome Web Store.
# Zips only the files the extension needs at runtime (manifest, service worker,
# and icons) into dist/monkgrab-v<version>.zip. Docs, license, and dev files are
# excluded from the upload.
set -euo pipefail

cd "$(dirname "$0")"

VERSION=$(node -p "require('./manifest.json').version" 2>/dev/null \
  || python3 -c "import json;print(json.load(open('manifest.json'))['version'])")

OUT="dist/monkgrab-v${VERSION}.zip"
mkdir -p dist
rm -f "$OUT"

# Files that ship in the extension package.
zip -r "$OUT" \
  manifest.json \
  background.js \
  icons \
  -x "icons/icon.svg"          # source art, not needed at runtime

echo
echo "Built $OUT"
unzip -l "$OUT"
