# BookMarkMap — Chrome 扩展

用「树状结构 + 思维导图」更高效地管理 Chrome 书签：搜索、AI 智能搜索、重命名/移动/删除、失效链接检测。

> Manifest V3 · Vite + React + TypeScript · 构建产物在 `dist/`

---

## 项目优势（你会喜欢它的原因）
- **更适合"整理党"**：主页面 + 思维导图两种视角，既能批量管理，也能像 XMind 一样拖拽重组书签结构。
- **AI 智能搜索**：支持自然语言搜索书签（如："找到所有前端开发相关的文章"），语义理解匹配，不仅仅是关键词。
- **失效链接一键收纳**：检测进度可视化，支持把失效书签统一移动到"已失效书签"文件夹。
- **权限更克制**：站点访问权限使用 `optional_host_permissions`，仅在你执行「AI 搜索 / 失效检测」等需要联网的功能时才会弹窗请求授权。

---

## 快速上手（普通用户）

### 方式 1：Chrome 应用商店（推荐）
上架后：在 Chrome Web Store 搜索 **“BookMarkMap”** 安装即可。

### 方式 2：GitHub / 网盘分发（需要开发者模式）
1. 下载发布包（通常是一个包含 `dist/` 的 zip）。
2. 解压后打开 Chrome：`chrome://extensions/`
3. 打开「开发者模式」
4. 点击「加载已解压的扩展程序」→ 选择解压后的 **`dist/`** 目录
5. 点击扩展图标打开 Popup 开始使用

> 说明：Chrome 对“非商店来源”的扩展通常会要求开发者模式；如果希望给非技术用户更顺滑的安装体验，建议优先上架 Chrome Web Store。

---

## 功能一览

### Popup（工具栏弹窗）
- 树状展示 + 搜索 + 展开状态记忆
- **AI 智能搜索**：切换到 AI 模式，使用自然语言搜索书签（如："前端开发相关的文章"）
- 右键菜单：打开 / 复制链接 / 重命名 / 移动到… / 删除
- 失效链接检测（🔍）：显示进度与失效列表；可一键移动到"已失效书签"文件夹
- 快捷入口：完整页面 / 思维导图 / 设置

### 主页面（完整页面）
- 全部 / 最近（默认近 7 天）视图
- 一键全部展开/收起
- 右键菜单：打开 / 复制链接 / 重命名 / 移动到… / 删除
- 新建文件夹
- 失效链接检测：进度条 + 结果列表 + 一键移动到"已失效书签"

### 思维导图（MindMap）
- 节点拖拽移动：把书签/文件夹拖到另一个文件夹节点下
- 右键菜单：打开 / 复制 / 展开收起 / 删除
- 默认展示层级 `depth` 仅影响初始展开；仍可继续手动展开更深层

### AI 智能搜索
- 多配置支持（Kimi / DeepSeek / GLM / 自定义 OpenAI 兼容端点）
- 自然语言查询：用人类语言描述需求，AI 理解语义返回相关书签
- 相关度评分：每个结果显示 0-100 的匹配度
- 匹配原因说明：AI 解释为什么推荐这个书签
- 智能缓存：相同查询 5 分钟内直接返回缓存结果
- 传统/AI 模式一键切换

---

## 开发者快速开始（参与开发/自定义）

> ⚠️ **不要直接把仓库根目录加载为扩展**。本项目是 React/TS，需要先构建，Chrome 实际加载的是 `dist/`。

```bash
npm install
npm run dev
```

然后在 `chrome://extensions/` 中加载 `dist/`。

生产构建：
```bash
npm run build
```

---

## 文档
- 使用指南：`user_guide.md`
- AI 配置指南（端点必须包含 `/chat/completions`）：`ai_guide.md`
- 项目说明 / Roadmap：`plan.md`
- 隐私说明（上架前建议放到可访问的 URL）：`privacy.md`

---

## 权限与隐私
- `bookmarks`：读取与管理你的书签（移动/重命名/删除等）
- `storage`：保存设置（包含你填写的 API Key）
- `tabs`：打开书签/页面
- `optional_host_permissions`：仅在需要联网功能（AI 搜索 / 失效检测）时请求站点访问授权

更详细说明见：`privacy.md`

---

## 常见问题

### Popup 显示“正在初始化 / JavaScript 加载失败”
通常是加载目录不对：请确保加载的是 **构建产物 `dist/`**（并先运行 `npm run dev` 或 `npm run build`）。

### 检测失效链接 / AI 测试连接没有反应
完成这些功能需要站点访问授权；首次使用会弹窗请求。你也可以在扩展详情页撤销/重新授予权限。

---

## 发布（打包分发）

### 本地打包（用于 CWS / 网盘）
```bash
npm run build
cd dist
zip -r ../bookmark-map.zip .
```

> 说明：上传到 Chrome Web Store 的 zip 需要让 `manifest.json` 位于 zip 根目录；以上写法满足该要求。

### GitHub Actions（自动构建产物）
仓库已提供工作流：
- `CI`：每次 push/PR 自动 `npm ci` + `npm run build`
- `Release`：推送 tag（例如 `v1.1.0`）后，自动构建并生成 `bookmark-map-<version>.zip` + `sha256`，上传到 GitHub Release

---

## License
MIT — 见 `LICENSE`

## Changelog
见 `CHANGELOG.md`

## Contributing
见 `CONTRIBUTING.md`
