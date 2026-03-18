# 小红书展示图（1080×1440）

已生成图片（可直接上传）：

- `images/xhs/00-封面.png`
- `images/xhs/01-首页.png`
- `images/xhs/02-AI搜索.png`
- `images/xhs/03-思维导图.png`

对应模板（可改文案/配色/排版）：

- `images/xhs/templates/poster-00-cover.html`
- `images/xhs/templates/poster-01-home.html`
- `images/xhs/templates/poster-02-ai.html`
- `images/xhs/templates/poster-03-mindmap.html`

## 如何重新生成

在 macOS 上使用 Chrome headless 渲染 HTML → PNG：

```bash
bash scripts/render-xhs-posters.sh
```

说明：

- 输出尺寸固定为 1080×1440，适合小红书竖图。
- 模板里引用的原始截图位于 `images/`，请保持文件名不变或同步修改模板中的路径。
