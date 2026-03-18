#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"

if [ ! -d "$DIST_DIR" ]; then
  echo "❌ dist/ not found. Run build first."
  exit 1
fi

if [ ! -f "$DIST_DIR/manifest.json" ]; then
  echo "❌ dist/manifest.json not found."
  exit 1
fi

# Basic manifest sanity check
if ! node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); console.log('manifest ok');" "$DIST_DIR/manifest.json" >/dev/null; then
  echo "❌ dist/manifest.json is not valid JSON."
  exit 1
fi

MANIFEST_VERSION="$(node -e "const m=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); console.log(String(m.manifest_version||''));" "$DIST_DIR/manifest.json")"
if [ "$MANIFEST_VERSION" != "3" ]; then
  echo "❌ manifest_version is not 3 (got: $MANIFEST_VERSION)"
  exit 1
fi

echo "✅ manifest_version=3"

# No remote scripts in extension pages
if rg -n "<script[^>]+src=['\\\"]https?://" "$DIST_DIR" -S >/dev/null; then
  echo "❌ Found remote <script src=\"http(s)://...\"> in dist/"
  rg -n "<script[^>]+src=['\\\"]https?://" "$DIST_DIR" -S || true
  exit 1
fi
echo "✅ no remote script tags"

# Avoid obvious remote code loading (best-effort)
if rg -n "import\\(['\\\"]https?://|fetch\\(['\\\"]https?://[^'\\\"]+\\.js" "$DIST_DIR/assets" -S >/dev/null 2>&1; then
  echo "⚠️  Found patterns that look like remote code loading in dist/assets (please review):"
  rg -n "import\\(['\\\"]https?://|fetch\\(['\\\"]https?://[^'\\\"]+\\.js" "$DIST_DIR/assets" -S || true
fi

# Disallow eval/new Function in built assets (best-effort)
if rg -n "\\beval\\(|new Function\\(" "$DIST_DIR/assets" -S >/dev/null; then
  echo "❌ Found eval/new Function in dist/assets"
  rg -n "\\beval\\(|new Function\\(" "$DIST_DIR/assets" -S || true
  exit 1
fi
echo "✅ no eval/new Function in assets"

# Ensure no TS/TSX sources accidentally shipped
if find "$DIST_DIR" -type f \( -name "*.ts" -o -name "*.tsx" \) | rg -n "." >/dev/null; then
  echo "❌ Found TypeScript sources in dist/ (should not be shipped)"
  find "$DIST_DIR" -type f \( -name "*.ts" -o -name "*.tsx" \) -print
  exit 1
fi
echo "✅ no TS/TSX shipped"

echo "✅ audit passed"

