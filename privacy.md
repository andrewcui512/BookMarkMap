# 隐私说明（Privacy）

本扩展尽量在本地完成所有操作。只有在你主动使用相关功能时，才会发起网络请求或向你配置的 AI 服务发送数据。

## 我们会存储什么
- 扩展设置（包含你填写的 API 端点 / API Key / 模型等）存储在 `chrome.storage.sync`（便于在同一账号的 Chrome 之间同步）。

## 我们会发送什么（何时发送）
- **AI 智能搜索**：当你在搜索框切换到 AI 模式并输入查询时，会把书签的 **标题** 以及用于识别站点/内容的 **URL 提示信息** 发送到你配置的 AI API 端点用于语义搜索（默认不发送 URL 的查询参数；路径信息可能会以“hostname + pathname”的形式被发送，用于提高匹配准确度）。
- **失效链接检测**：当你点击"检测失效链接"时，会对书签 URL 发起 `HEAD/GET` 请求来判断链接是否可访问（不读取页面内容，仅用于判断状态码/超时等）。

## 权限说明
- `bookmarks`：读取与管理你的书签（重命名/移动/删除等）。
- `storage`：保存设置（包含 API Key）。
- `tabs`：打开书签/页面。
- **可选站点访问权限（optional_host_permissions）**：仅在你使用"AI 搜索 / 失效链接检测"等需要联网的功能时向你请求授权，可在扩展详情页随时撤销。

## 数据安全
- ✅ 所有数据存储在本地（chrome.storage）
- ✅ API Key 由 Chrome 加密存储
- ✅ 不向任何第三方服务器发送数据（除了你配置的 AI 端点）
- ✅ 不收集用户行为数据
- ✅ 不包含追踪代码或广告

---

# Privacy Policy (English)

This extension aims to work locally whenever possible. It only makes network requests or sends data to your configured AI provider when you explicitly use those features.

## What we store
- Extension settings (including API endpoint / API key / model) are stored in `chrome.storage.sync` for convenience across your signed-in Chrome browsers.

## What we send (and when)
- **AI Search**: When you switch to AI mode in the search box and enter a query, bookmark **titles** and a minimal **URL hint** are sent to the AI endpoint you configured for semantic search (query parameters are not sent by default; a pathname may be included as `hostname + pathname` to improve matching).
- **Broken link check**: When you run link checking, the extension sends `HEAD/GET` requests to bookmark URLs to determine availability (status code / timeout). It does not read page content.

## Permissions
- `bookmarks`: read/manage bookmarks (rename/move/delete).
- `storage`: store settings (including API key).
- `tabs`: open bookmarks/pages.
- **Optional site access (optional_host_permissions)**: requested only when needed for AI search/link-check features and can be revoked anytime in the extension details page.

## Data Security
- ✅ All data stored locally (chrome.storage)
- ✅ API keys encrypted by Chrome
- ✅ No data sent to third-party servers (except your configured AI endpoint)
- ✅ No user behavior tracking
- ✅ No tracking code or ads
