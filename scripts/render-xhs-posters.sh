#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

OUT_DIR="$ROOT_DIR/images/xhs"
TPL_DIR="$ROOT_DIR/images/xhs/templates"

mkdir -p "$OUT_DIR"

render() {
  local template="$1"
  local out="$2"

  "$CHROME" \
    --headless=new \
    --disable-gpu \
    --hide-scrollbars \
    --allow-file-access-from-files \
    --window-size=1080,1440 \
    --virtual-time-budget=1500 \
    --screenshot="$out" \
    "file://$template" >/dev/null
}

render "$TPL_DIR/poster-01-home.html" "$OUT_DIR/01-首页.png"
render "$TPL_DIR/poster-02-ai.html" "$OUT_DIR/02-AI搜索.png"
render "$TPL_DIR/poster-03-mindmap.html" "$OUT_DIR/03-思维导图.png"
render "$TPL_DIR/poster-00-cover.html" "$OUT_DIR/00-封面.png"

echo "OK: generated posters in $OUT_DIR"
