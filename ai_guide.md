# AI 配置指南（Kimi / DeepSeek / GLM）

本项目的 AI 功能走“OpenAI 兼容（Chat Completions）”请求格式。你可以在 **AI 智能分类页** 添加/管理多个 API 配置，并选择“当前配置”来执行分类（支持生成建议，并可选择是否应用：创建文件夹 + 移动书签）。

## 1) 本项目需要的 API 形态

扩展后台会按如下方式请求你的模型服务（关键点：**端点必须是完整的 chat/completions URL**）：

- Method：`POST`
- Header：
  - `Content-Type: application/json`
  - `Authorization: Bearer <你的Key>`
- Body（示例）：
  - `model`: 你填写的模型名称
  - `messages`: `[{ role: "user", content: "..." }]`

因此，只要厂商提供 **OpenAI 兼容** 的 Chat Completions 接口（或你使用了兼容网关/代理），就可以直接接入。

## 2) 扩展里怎么配置

推荐入口：打开 **AI 智能分类页**（主页面/Popup 的“AI 智能分类”按钮会打开）。

也可以在“设置页”填写（它会同步更新到“当前 AI 配置”）。

- **API 端点**：填写完整 URL（包含 `/chat/completions`）
- **API 密钥**：填写厂商给你的 Key
- **模型名称**：填写厂商模型 ID（不确定可先留空，再按厂商文档填写；留空时后台默认会用 `gpt-3.5-turbo`，但对国内厂商通常需要显式填写正确模型名）
- 点击“测试连接”验证是否能返回成功（AI 页会记录 token 用量统计，前提是服务端返回 `usage` 字段）

> 注意：如果你填的是“基础地址”（例如只填到 `/v1` 或域名根），本项目当前不会自动补全路径；请直接填完整的 `.../chat/completions`。

## 3) 常用厂商配置示例（中国大陆用户）

下面给的是**常见** OpenAI 兼容配置写法（不同账号/产品线可能有差异；以各厂商官方文档为准）。

| 厂商 | API 端点（示例） | 模型名称（示例） | 备注 |
|------|------------------|------------------|------|
| Kimi（月之暗面 Moonshot） | `https://api.moonshot.cn/v1/chat/completions` | `moonshot-v1-8k` / `moonshot-v1-32k` / `moonshot-v1-128k` | 走 OpenAI 兼容风格较常见 |
| DeepSeek | `https://api.deepseek.com/v1/chat/completions` | `deepseek-chat` / `deepseek-reasoner` | 若返回 404，多半是端点路径不对 |
| GLM（智谱 BigModel） | `https://open.bigmodel.cn/api/paas/v4/chat/completions` | `glm-4` / `glm-4-air` 等 | 请按文档确认版本号与模型名 |

## 4) 常见问题排查

- **401 / 403**：Key 不对、权限没开、或 Header 形式不被支持（本项目固定用 `Authorization: Bearer ...`）
- **404**：端点路径不对（最常见：漏了 `/chat/completions` 或版本号不匹配）
- **网络超时/失败**：本地网络、公司代理、DNS 等问题；建议先用 `curl` 或 Postman 验证端点可用
- **400 content_filter / high risk**：请求被服务端内容安全风控拒绝。通常是书签标题/域名里包含敏感词或高风险内容导致。建议：1）减少一次分类的书签数量（按文件夹分批）；2）临时删除/改名可疑书签再试；3）更换模型/厂商。扩展已默认尽量避免发送完整 URL（只发送标题 + 域名），并在必要时自动拆分/跳过触发风控的条目。
- **“API not configured”**：没填 API 端点或 Key（AI 页/设置页保存后再试）
- **AI 返回解析失败**：模型输出没按要求给 JSON；可在控制台看返回内容，或换更“听话”的模型/降低温度/减少分类数量

## 5) 安全提示

API Key 会保存在 `chrome.storage.sync`（会随 Chrome 登录账户同步）。如果你要发布给他人使用，建议补充隐私说明，并考虑：
- 让用户自行填写 Key（当前做法）
- 或提供自建网关，把 Key 放在服务端（扩展只拿到临时 token）

此外，为了降低隐私泄露风险与触发风控的概率，本项目在 AI 分类请求里默认只发送“书签标题 + 域名（hostname）”，不会发送完整 URL（包含路径/参数）。
