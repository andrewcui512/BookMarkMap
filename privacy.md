# 隐私说明（Privacy）

本扩展尽量在本地完成所有操作。只有在你主动使用相关功能时，才会发起网络请求或向你配置的 AI 服务发送数据。

## 我们会存储什么
- 扩展设置（包含你填写的 API 端点 / API Key / 模型等）存储在 `chrome.storage.sync`（便于在同一账号的 Chrome 之间同步）。

## 我们会发送什么（何时发送）
- **AI 智能分类**：当你点击“开始分类/应用分类”时，会把书签的 **标题与域名（hostname）** 发送到你配置的 AI API 端点用于生成分类建议（默认不发送完整 URL 的路径/参数）。可选：若开启“网页摘要提示”，扩展会本地访问少量标题不清晰的书签网页并提取 `title/description/h1` 作为 hint（仍不会把完整 URL/HTML 发送给 AI）。
- **失效链接检测**：当你点击“检测失效链接”时，会对书签 URL 发起 `HEAD/GET` 请求来判断链接是否可访问（不读取页面内容，仅用于判断状态码/超时等）。

## 权限说明
- `bookmarks`：读取与管理你的书签（重命名/移动/删除等）。
- `storage`：保存设置（包含 API Key）。
- `tabs`：打开书签/页面。
- **可选站点访问权限（optional_host_permissions）**：仅在你使用“AI 分类 / 失效链接检测”等需要联网的功能时向你请求授权，可在扩展详情页随时撤销。

---

# Privacy Policy (English)

This extension aims to work locally whenever possible. It only makes network requests or sends data to your configured AI provider when you explicitly use those features.

## What we store
- Extension settings (including API endpoint / API key / model) are stored in `chrome.storage.sync` for convenience across your signed-in Chrome browsers.

## What we send (and when)
- **AI classify**: When you run classification/apply, bookmark **titles and hostnames** are sent to the AI endpoint you configured to generate category suggestions (full URLs with paths/queries are not sent by default). Optional: if "webpage hints" is enabled, the extension may fetch a small number of webpages locally and extract `title/description/h1` as hints (it still does not send full URLs/HTML to the AI).
- **Broken link check**: When you run link checking, the extension sends `HEAD/GET` requests to bookmark URLs to determine availability (status code / timeout). It does not read page content.

## Permissions
- `bookmarks`: read/manage bookmarks (rename/move/delete).
- `storage`: store settings (including API key).
- `tabs`: open bookmarks/pages.
- **Optional site access (optional_host_permissions)**: requested only when needed for AI/link-check features and can be revoked anytime in the extension details page.
