# Chrome Web Store 素材（演示数据）

输出目录：`images/cws/`

## 已生成（可直接上传）

- 商店图标（必填 128×128）：`images/cws/store-icon-128x128.png`
- 截图（建议 1280×800）：`images/cws/screenshot-01-home-1280x800.png`
- 截图（建议 1280×800）：`images/cws/screenshot-02-ai-1280x800.png`
- 截图（建议 1280×800）：`images/cws/screenshot-03-mindmap-1280x800.png`
- 小宣传图（必填）：`images/cws/promo-tile-440x280.png`
- Marquee（可选）：`images/cws/marquee-1400x560.png`

## 模板（可改文案/示例数据）

位于 `images/cws/templates/`：

- `images/cws/templates/screenshot-01-home.html`
- `images/cws/templates/screenshot-02-ai.html`
- `images/cws/templates/screenshot-03-mindmap.html`
- `images/cws/templates/promo-tile-440x280.html`
- `images/cws/templates/marquee-1400x560.html`

## 重新生成

```bash
bash scripts/render-cws-assets.sh
```
