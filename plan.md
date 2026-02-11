# 书签树 (Bookmark Tree) — Chrome 扩展

> Manifest V3。用树状结构管理书签：搜索、重命名/删除/移动、失效链接检测、AI 智能分类（多配置 + 用量统计）。

## 当前状态（最后更新：2026-02-09）

### 已实现（可用）
- **Popup（弹窗）**：树状展示、搜索、展开状态记忆、右键菜单（打开/复制链接/重命名/删除）、跳转设置页/完整页面
- **主页面（全屏）**：全部/最近（近 7 天）/已失效视图、搜索、右键菜单（打开/复制/重命名/移动/删除）、新建文件夹、失效链接检测（批量 + 进度 + 可选移动到“已失效书签”文件夹）
- **AI 智能分类页**：支持多 API 配置（Kimi / DeepSeek / GLM / 自定义）、一键切换当前配置、测试连接、token 用量统计、生成分类建议并可一键应用（创建文件夹 + 移动书签）
- **设置页**：API 端点/Key/模型（会同步到“当前 AI 配置”）、测试连接、防火墙白名单、深色模式、语言
- **后台 Service Worker**：默认设置初始化；AI 请求（OpenAI 兼容 Chat Completions）；token 用量统计写入配置；设置读写；书签变更事件监听（目前仅日志）
- **国际化**：`zh_CN` / `en`（部分页面仍存在硬编码文案）

### 已知限制 / 待改进
- Popup 里“移动 / 检测失效链接”按钮目前仍是占位提示（核心能力在主页面）
- AI 的“token 用量统计”依赖服务端返回 `usage` 字段；部分厂商/网关可能不返回或字段不同
- AI 输出解析依赖模型按要求返回 JSON；如失败可尝试更换模型/降低温度/减少分类数量
- `host_permissions` 目前为 `<all_urls>`（便于调试；若计划上架建议收敛到具体域名）

## 快速开始（调试安装）
1. 打开 Chrome → `chrome://extensions/`
2. 打开“开发者模式”
3. “加载已解压的扩展程序” → 选择本项目目录 `BookMark_Tree/`
4. 点击扩展图标打开 Popup，或在 Popup 里点击“打开完整页面”

## 目录结构（与仓库一致）

```
BookMark_Tree/
├── manifest.json
├── plan.md
├── ai_guide.md
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── pages/
│   ├── ai/
│   │   ├── ai.html
│   │   ├── ai.css
│   │   └── ai.js
│   ├── main/
│   │   ├── main.html
│   │   ├── main.css
│   │   └── main.js
│   └── settings/
│       ├── settings.html
│       ├── settings.css
│       └── settings.js
├── scripts/
│   ├── background.js
│   ├── bookmark-manager.js
│   ├── link-checker.js
│   └── tree-renderer.js
├── styles/
│   ├── variables.css
│   ├── common.css
│   └── tree.css
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── _locales/
    ├── en/messages.json
    └── zh_CN/messages.json
```

## 核心模块（实现来源）
- `scripts/bookmark-manager.js`：封装 `chrome.bookmarks`（CRUD + 本地搜索/flatten + “已失效书签”文件夹与批量移动）
- `scripts/link-checker.js`：批量检测 URL（白名单 + HEAD/GET，`no-cors`）
- `scripts/tree-renderer.js`：树渲染（展开状态保存在 `chrome.storage.local`）
- `scripts/background.js`：Service Worker（消息路由、AI 请求、设置读写）

## AI 集成（OpenAI 兼容 Chat Completions）
- 本项目 AI 请求使用“OpenAI 兼容”格式：`POST` + `Authorization: Bearer <API_KEY>` + `model/messages`
- 支持多配置：保存在 `settings.aiConfigs`，当前使用项为 `settings.activeAiConfigId`
- 具体配置方式与 Kimi / DeepSeek / GLM 的示例见：`ai_guide.md`

## 权限说明（manifest）
| 权限 | 用途 |
|------|------|
| `bookmarks` | 读取与管理书签 |
| `storage` | 保存设置（含 API Key） |
| `tabs` | 打开新标签页等 |
| `host_permissions` | 允许访问外部 API / 站点（当前为 `<all_urls>`） |

## Roadmap（下一步优先级）
- [ ] AI：分类建议支持手动编辑/合并分类 + 应用前预检（目标文件夹是否已存在）
- [ ] AI：提供“撤销/回滚”（记录移动前 parentId/index，支持一键恢复）
- [ ] Popup：实现“移动到...”UI（可复用主页面的移动弹窗思路）
- [ ] Popup：接入“失效链接检测”并支持“移动到已失效书签”
- [ ] i18n：补齐主页面/设置页/弹窗的硬编码文案
- [ ] 发布准备：收敛 `host_permissions`、完善隐私说明（API Key 存储）、兼容性与异常处理
