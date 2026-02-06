# 书签树浏览器插件 (Bookmark Tree Extension)

> 一个帮助用户以树状结构可视化和管理浏览器书签的 Chrome 扩展程序，支持自定义分类和 AI 智能分类功能。

---

## 📋 项目概述

### 核心功能
1. **树状展示书签** - 以直观的树形结构展示所有浏览器书签
2. **自定义分类** - 支持用户创建、重命名、移动书签文件夹
3. **AI 智能分类** - 接入第三方 AI API（如 OpenAI、Claude 等）自动分类书签
4. **搜索与过滤** - 快速搜索和筛选书签
5. **批量操作** - 支持批量移动、删除书签

---

## 🏗️ 项目结构

```
BookMark_Tree/
├── manifest.json              # Chrome 扩展配置文件
├── plan.md                    # 项目计划文档
├── README.md                  # 项目说明文档
│
├── popup/                     # 弹出窗口界面
│   ├── popup.html             # 弹窗 HTML
│   ├── popup.css              # 弹窗样式
│   └── popup.js               # 弹窗逻辑
│
├── pages/                     # 独立页面
│   ├── main/                  # 主界面（全屏书签管理）
│   │   ├── main.html
│   │   ├── main.css
│   │   └── main.js
│   └── settings/              # 设置页面
│       ├── settings.html
│       ├── settings.css
│       └── settings.js
│
├── scripts/                   # 核心脚本
│   ├── background.js          # 后台服务脚本
│   ├── bookmark-manager.js    # 书签管理核心逻辑
│   ├── tree-renderer.js       # 树状结构渲染器
│   └── ai-classifier.js       # AI 分类模块
│
├── styles/                    # 公共样式
│   ├── common.css             # 通用样式
│   ├── tree.css               # 树形组件样式
│   └── variables.css          # CSS 变量定义
│
├── components/                # UI 组件
│   ├── tree-node.js           # 树节点组件
│   ├── context-menu.js        # 右键菜单组件
│   ├── modal.js               # 模态框组件
│   └── toast.js               # 提示消息组件
│
├── utils/                     # 工具函数
│   ├── storage.js             # 存储工具
│   ├── api.js                 # API 请求工具
│   └── helpers.js             # 通用辅助函数
│
├── icons/                     # 图标资源
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
│
└── _locales/                  # 国际化
    ├── en/
    │   └── messages.json
    └── zh_CN/
        └── messages.json
```

---

## 📦 技术栈

| 类别 | 技术选型 |
|------|----------|
| 平台 | Chrome Extension Manifest V3 |
| 语言 | JavaScript (ES6+) |
| 样式 | CSS3 + CSS Variables |
| 存储 | Chrome Storage API |
| 书签 | Chrome Bookmarks API |
| AI 接口 | OpenAI API / Claude API / 自定义 |

---

## 🔧 核心模块设计

### 1. manifest.json 配置

```json
{
  "manifest_version": 3,
  "name": "Bookmark Tree",
  "version": "1.0.0",
  "description": "以树状结构管理书签，支持 AI 智能分类",
  "permissions": [
    "bookmarks",
    "storage",
    "tabs"
  ],
  "host_permissions": [
    "https://api.openai.com/*",
    "https://api.anthropic.com/*"
  ],
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "background": {
    "service_worker": "scripts/background.js"
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

### 2. 书签管理模块 (bookmark-manager.js)

**核心功能：**
- `getAllBookmarks()` - 获取所有书签
- `createFolder(parentId, title)` - 创建文件夹
- `moveBookmark(bookmarkId, targetFolderId)` - 移动书签
- `renameFolder(folderId, newTitle)` - 重命名文件夹
- `deleteBookmark(bookmarkId)` - 删除书签
- `searchBookmarks(query)` - 搜索书签

### 3. 树状渲染器 (tree-renderer.js)

**核心功能：**
- `renderTree(container, bookmarkTree)` - 渲染书签树
- `expandNode(nodeId)` - 展开节点
- `collapseNode(nodeId)` - 折叠节点
- `toggleNode(nodeId)` - 切换节点状态
- `highlightNode(nodeId)` - 高亮节点

### 4. AI 分类模块 (ai-classifier.js)

**核心功能：**
- `setApiConfig(provider, apiKey)` - 设置 API 配置
- `classifyBookmarks(bookmarks)` - 批量分类书签
- `suggestCategory(bookmark)` - 为单个书签建议分类
- `autoOrganize()` - 自动整理所有书签

**支持的 AI 提供商：**
- OpenAI (GPT-4 / GPT-3.5)
- Anthropic Claude
- 自定义 API 端点

---

## 🎨 UI 设计规范

### 配色方案

```css
:root {
  /* 主色调 */
  --primary-color: #4F46E5;
  --primary-hover: #4338CA;
  
  /* 背景色 */
  --bg-primary: #FFFFFF;
  --bg-secondary: #F9FAFB;
  --bg-tertiary: #F3F4F6;
  
  /* 文字色 */
  --text-primary: #111827;
  --text-secondary: #6B7280;
  
  /* 边框色 */
  --border-color: #E5E7EB;
  
  /* 功能色 */
  --success: #10B981;
  --warning: #F59E0B;
  --error: #EF4444;
  
  /* 暗色模式 */
  --dark-bg-primary: #1F2937;
  --dark-bg-secondary: #111827;
  --dark-text-primary: #F9FAFB;
}
```

### 树节点样式

- 文件夹图标：📁 (展开) / 📂 (折叠)
- 书签图标：使用网站 favicon 或默认 🔖
- 缩进：每级 20px
- 节点高度：36px
- 悬浮效果：背景色变化 + 轻微阴影

---

## 📝 开发计划

### 第一阶段：基础框架 (预计 2 天)

- [ ] 初始化项目结构
- [ ] 编写 manifest.json
- [ ] 创建基础 popup 界面
- [ ] 实现书签读取功能
- [ ] 基础树形结构展示

### 第二阶段：核心功能 (预计 3 天)

- [ ] 完善树状展示组件
  - [ ] 展开/折叠动画
  - [ ] 拖拽排序
  - [ ] 右键菜单
- [ ] 实现书签管理功能
  - [ ] 创建文件夹
  - [ ] 重命名
  - [ ] 移动书签
  - [ ] 删除书签
- [ ] 搜索功能实现

### 第三阶段：AI 分类 (预计 2 天)

- [ ] AI API 接口封装
- [ ] 设置页面 - API 配置
- [ ] 分类逻辑实现
  - [ ] 单个书签分类
  - [ ] 批量分类
  - [ ] 分类建议 UI
- [ ] 分类结果预览与确认

### 第四阶段：优化完善 (预计 2 天)

- [ ] 深色模式支持
- [ ] 国际化 (中/英文)
- [ ] 性能优化
- [ ] 错误处理完善
- [ ] 用户引导

### 第五阶段：测试发布 (预计 1 天)

- [ ] 功能测试
- [ ] 兼容性测试
- [ ] 打包发布
- [ ] 编写文档

---

## 🔌 AI API 集成

### OpenAI 集成示例

```javascript
async function classifyWithOpenAI(bookmarks, apiKey) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: '你是一个书签分类助手。根据书签的标题和URL，为其建议合适的分类文件夹名称。'
        },
        {
          role: 'user',
          content: `请为以下书签建议分类：\n${JSON.stringify(bookmarks)}`
        }
      ]
    })
  });
  
  return response.json();
}
```

### API 配置存储

```javascript
// 使用 Chrome Storage 安全存储 API 密钥
async function saveApiConfig(provider, apiKey) {
  await chrome.storage.sync.set({
    aiConfig: {
      provider,
      apiKey: btoa(apiKey) // 简单编码存储
    }
  });
}
```

---

## 🔐 权限说明

| 权限 | 用途 |
|------|------|
| `bookmarks` | 读取和管理浏览器书签 |
| `storage` | 保存用户设置和 API 配置 |
| `tabs` | 获取当前标签页信息（可选） |
| `host_permissions` | 访问 AI API 服务 |

---

## 📄 待确认事项

> [!IMPORTANT]
> 请确认以下事项：

1. **目标浏览器** - 是否只支持 Chrome，还是也需要支持 Firefox/Edge？
2. **AI 提供商优先级** - 优先集成哪个 AI 服务？(OpenAI / Claude / 其他)
3. **语言支持** - 是否需要英文版本？
4. **数据导出** - 是否需要书签导出/导入功能？

---

## 🚀 下一步

1. 确认上述待确认事项
2. 开始第一阶段开发 - 搭建基础项目框架
3. 创建必要的项目文件

---

*最后更新: 2026-01-30*
