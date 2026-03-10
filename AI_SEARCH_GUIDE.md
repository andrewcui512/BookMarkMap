# AI 搜索配置指南

## 📖 如何配置 AI 搜索

BookMarkMap 的 AI 智能搜索功能需要用户自己配置 AI 服务。我们支持多个主流 AI 服务商，你可以选择任意一个。

---

## 🚀 快速开始

### 步骤 1：打开设置页面

1. 点击浏览器工具栏的 BookMarkMap 图标
2. 点击右上角的「⚙️ 设置」按钮
3. 找到「🤖 AI 配置」区域

### 步骤 2：选择 AI 服务商

我们支持以下 AI 服务商（任选其一）：

#### 选项 1：Kimi（月之暗面）
- **官网**：https://platform.moonshot.cn/
- **API 端点**：`https://api.moonshot.cn/v1/chat/completions`
- **推荐模型**：`moonshot-v1-8k` 或 `moonshot-v1-32k`
- **价格**：新用户有免费额度

#### 选项 2：DeepSeek
- **官网**：https://platform.deepseek.com/
- **API 端点**：`https://api.deepseek.com/v1/chat/completions`
- **推荐模型**：`deepseek-chat`
- **价格**：价格便宜，性价比高

#### 选项 3：智谱 GLM
- **官网**：https://open.bigmodel.cn/
- **API 端点**：`https://open.bigmodel.cn/api/paas/v4/chat/completions`
- **推荐模型**：`glm-4-flash` 或 `glm-4`
- **价格**：新用户有免费额度

#### 选项 4：自定义（OpenAI 兼容）
- 支持任何 OpenAI 兼容的 API
- 包括：OpenAI、Azure OpenAI、本地部署的模型等
- **API 端点**：你的服务地址（必须包含 `/chat/completions`）

### 步骤 3：获取 API Key

以 Kimi 为例：

1. 访问 https://platform.moonshot.cn/
2. 注册/登录账号
3. 进入「API Keys」页面
4. 点击「创建新的 API Key」
5. 复制生成的 API Key（格式类似：`sk-xxxxxxxxxxxxx`）

> 💡 其他服务商的流程类似，都是在控制台创建 API Key

### 步骤 4：填写配置

在 BookMarkMap 设置页面填写：

1. **API 端点**：粘贴上面对应服务商的 API 端点
2. **API Key**：粘贴你获取的 API Key
3. **模型**：填写推荐的模型名称

示例（Kimi）：
```
API 端点：https://api.moonshot.cn/v1/chat/completions
API Key：sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
模型：moonshot-v1-8k
```

### 步骤 5：测试连接

1. 点击「🔌 测试连接」按钮
2. 首次使用会弹出权限请求，点击「允许」
3. 如果配置正确，会显示「✅ OK (XXXms)」
4. 如果失败，检查 API 端点和 Key 是否正确

### 步骤 6：保存设置

点击「💾 保存设置」按钮（或按 Ctrl+S）

---

## 🎯 使用 AI 搜索

配置完成后：

1. 点击工具栏图标打开 Popup
2. 在搜索框右侧，点击切换到「🤖 AI」模式
3. 输入自然语言查询，例如：
   - "找到所有前端开发相关的文章"
   - "机器学习和深度学习的资料"
   - "最近保存的技术文档"
4. AI 会返回最相关的书签，并显示相关度评分和匹配原因

---

## 💰 费用说明

### 免费额度
- **Kimi**：新用户有免费额度
- **DeepSeek**：价格极低，几乎可以忽略
- **智谱 GLM**：新用户有免费额度

### 预估成本
- 每次 AI 搜索大约消耗 500-2000 tokens
- 以 DeepSeek 为例：1 元可以搜索数千次
- 建议：先用免费额度测试，满意后再充值

### 节省成本的技巧
1. 使用缓存：相同查询 5 分钟内不会重复调用 API
2. 精简查询：用简短的句子描述需求
3. 混合使用：简单搜索用传统模式，复杂需求用 AI 模式

---

## 🔒 隐私与安全

### 数据安全
- ✅ API Key 存储在本地（chrome.storage.sync）
- ✅ Chrome 会自动加密存储
- ✅ 不会发送到任何第三方服务器

### 发送的数据
AI 搜索时，我们只发送：
- 书签的**标题**
- 书签的**域名**（如 github.com）
- 你的**搜索查询**

**不会发送**：
- 完整的 URL（不包含路径和参数）
- 书签内容
- 浏览历史
- 其他个人信息

### 服务商选择
- 所有推荐的服务商都是正规公司
- 你可以查看各服务商的隐私政策
- 如果担心隐私，可以使用本地部署的模型

---

## ❓ 常见问题

### Q1: 测试连接失败怎么办？

**检查清单**：
1. API 端点是否正确（必须包含 `/chat/completions`）
2. API Key 是否正确（注意不要有多余空格）
3. 模型名称是否正确
4. 是否允许了权限请求
5. 网络是否正常

**常见错误**：
- `401 Unauthorized`：API Key 错误或已过期
- `403 Forbidden`：API Key 没有权限
- `404 Not Found`：API 端点错误
- `429 Too Many Requests`：请求过于频繁，稍后再试
- `500 Internal Server Error`：服务商服务器错误

### Q2: 可以配置多个 AI 服务吗？

当前版本只支持一个 AI 配置。如果需要切换服务商，直接修改配置即可。

### Q3: AI 搜索结果不准确怎么办？

**优化建议**：
1. 使用更具体的描述（如："React 相关的教程"而不是"前端"）
2. 尝试不同的表达方式
3. 确保书签标题清晰（AI 主要根据标题匹配）
4. 如果结果不满意，切换回传统搜索模式

### Q4: 为什么要自己配置 AI？

**原因**：
1. **成本控制**：你可以选择最适合自己的服务商和价格
2. **隐私保护**：数据直接发送到你选择的服务商，不经过我们
3. **灵活性**：可以使用本地部署的模型，完全离线
4. **合规性**：避免我们代理 API 可能带来的法律问题

### Q5: 不配置 AI 可以用吗？

可以！AI 搜索是可选功能。不配置的话：
- ✅ 传统搜索功能完全可用
- ✅ 树状视图、思维导图正常使用
- ✅ 失效链接检测正常使用
- ❌ 无法使用 AI 智能搜索

---

## 🎓 进阶配置

### 使用本地模型

如果你有本地部署的 OpenAI 兼容模型（如 Ollama、LocalAI 等）：

1. 确保模型服务已启动
2. 在设置中填写本地地址，例如：
   ```
   API 端点：http://localhost:11434/v1/chat/completions
   API Key：ollama（或留空，取决于你的配置）
   模型：llama2（或你的模型名称）
   ```
3. 测试连接

### 使用 Azure OpenAI

如果你有 Azure OpenAI 服务：

1. 获取你的 Azure OpenAI 端点和 Key
2. 端点格式：`https://your-resource.openai.azure.com/openai/deployments/your-deployment/chat/completions?api-version=2024-02-15-preview`
3. 填写配置并测试

---

## 📞 需要帮助？

- **GitHub Issues**：https://github.com/yourusername/BookMarkMap/issues
- **文档**：查看项目 README.md
- **隐私政策**：查看 privacy.md

---

**祝使用愉快！🎉**
