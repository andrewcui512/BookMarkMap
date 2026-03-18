#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

OUT_DIR="$ROOT_DIR/images/cws"
TPL_DIR="$ROOT_DIR/images/cws/templates"

mkdir -p "$OUT_DIR"

render() {
  local w="$1"
  local h="$2"
  local template="$3"
  local out="$4"

  "$CHROME" \
    --headless=new \
    --disable-gpu \
    --hide-scrollbars \
    --allow-file-access-from-files \
    --window-size="${w},${h}" \
    --virtual-time-budget=1500 \
    --screenshot="$out" \
    "file://$template" >/dev/null
}

render 1280 800 "$TPL_DIR/screenshot-01-home.html" "$OUT_DIR/screenshot-01-home-1280x800.png"
render 1280 800 "$TPL_DIR/screenshot-02-ai.html" "$OUT_DIR/screenshot-02-ai-1280x800.png"
render 1280 800 "$TPL_DIR/screenshot-03-mindmap.html" "$OUT_DIR/screenshot-03-mindmap-1280x800.png"
render 440 280 "$TPL_DIR/promo-tile-440x280.html" "$OUT_DIR/promo-tile-440x280.png"
render 1400 560 "$TPL_DIR/marquee-1400x560.html" "$OUT_DIR/marquee-1400x560.png"

echo "OK: generated CWS assets in $OUT_DIR"

