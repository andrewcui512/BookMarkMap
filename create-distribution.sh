#!/bin/bash

# 创建用户分发包（可直接加载到浏览器）
# 用法: ./create-distribution.sh

set -e

echo "📦 创建用户分发包..."

# 1. 清理并构建
echo "🔨 构建项目..."
rm -rf dist/
npm run build

# 2. 检查构建结果
if [ ! -d "dist" ]; then
    echo "❌ 构建失败：dist 目录不存在"
    exit 1
fi

# 3. 创建分发目录
DIST_DIR="BookMarkMap-v$(node -p "require('./package.json').version")"
echo "📁 创建分发目录：$DIST_DIR"
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

# 4. 复制构建产物
echo "📋 复制文件..."
cp -r dist/* "$DIST_DIR/"

# 5. 添加用户说明文件
cat > "$DIST_DIR/安装说明.txt" << 'EOF'
BookMarkMap 安装说明
==================

感谢使用 BookMarkMap！

## 安装步骤

1. 打开 Chrome 浏览器
2. 在地址栏输入：chrome://extensions/
3. 打开右上角的「开发者模式」开关
4. 点击「加载已解压的扩展程序」
5. 选择本文件夹（BookMarkMap-vX.X.X）
6. 安装完成！点击工具栏的扩展图标即可使用

## 功能说明

- 📚 树状结构管理书签
- 🗺️ 思维导图可视化
- 🤖 AI 智能搜索（需配置 AI 服务）
- 🔍 失效链接检测

## AI 搜索配置

1. 点击扩展图标打开 Popup
2. 点击右上角「⚙️ 设置」
3. 在「AI 配置」区域添加你的 AI 服务
4. 支持：Kimi、DeepSeek、GLM、自定义 OpenAI 兼容端点
5. 配置完成后，在搜索框切换到「AI」模式即可使用

## 注意事项

- 本扩展需要「开发者模式」才能加载
- 如果 Chrome 提示「扩展程序可能很快会被停用」，请忽略，这是正常提示
- 建议等待 Chrome Web Store 版本上架后，从商店安装（无需开发者模式）

## 隐私说明

- 所有数据存储在本地
- 不收集用户行为数据
- AI 搜索仅在你配置的端点进行
- 详细隐私政策：https://github.com/yourusername/BookMarkMap/blob/main/privacy.md

## 问题反馈

GitHub: https://github.com/yourusername/BookMarkMap/issues

祝使用愉快！
EOF

cat > "$DIST_DIR/README.txt" << 'EOF'
BookMarkMap Installation Guide
==============================

Thank you for using BookMarkMap!

## Installation Steps

1. Open Chrome browser
2. Enter in address bar: chrome://extensions/
3. Enable "Developer mode" toggle in the top right
4. Click "Load unpacked"
5. Select this folder (BookMarkMap-vX.X.X)
6. Done! Click the extension icon in toolbar to use

## Features

- 📚 Tree structure bookmark management
- 🗺️ Mind map visualization
- 🤖 AI-powered search (requires AI service configuration)
- 🔍 Broken link detection

## AI Search Configuration

1. Click extension icon to open Popup
2. Click "⚙️ Settings" in top right
3. Add your AI service in "AI Configuration" section
4. Supports: Kimi, DeepSeek, GLM, Custom OpenAI-compatible endpoints
5. After configuration, switch to "AI" mode in search box

## Notes

- This extension requires "Developer mode" to load
- If Chrome shows "Extensions may be disabled soon", ignore it - this is normal
- Recommended to install from Chrome Web Store when available (no developer mode needed)

## Privacy

- All data stored locally
- No user behavior tracking
- AI search only uses your configured endpoint
- Privacy policy: https://github.com/yourusername/BookMarkMap/blob/main/privacy.md

## Feedback

GitHub: https://github.com/yourusername/BookMarkMap/issues

Enjoy!
EOF

# 6. 创建 ZIP 包
ZIP_NAME="${DIST_DIR}.zip"
echo "🗜️  创建压缩包：$ZIP_NAME"
zip -r "$ZIP_NAME" "$DIST_DIR" -x "*.DS_Store" -x "__MACOSX/*"

# 7. 清理临时目录
rm -rf "$DIST_DIR"

# 8. 显示结果
SIZE=$(du -h "$ZIP_NAME" | cut -f1)
echo ""
echo "✅ 分发包创建完成！"
echo "📦 文件：$ZIP_NAME"
echo "📏 大小：$SIZE"
echo ""
echo "📤 分发说明："
echo "1. 将 $ZIP_NAME 上传到网盘（百度网盘、阿里云盘等）"
echo "2. 分享下载链接给用户"
echo "3. 用户下载后解压，按照「安装说明.txt」操作即可"
echo ""
echo "💡 提示："
echo "- 用户需要开启「开发者模式」才能加载"
echo "- 建议在分享时说明这是临时方案，推荐等 Chrome Web Store 版本"
echo ""
