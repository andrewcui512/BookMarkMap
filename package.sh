#!/bin/bash

# Chrome Web Store 打包脚本
# 用法: ./package.sh

set -e

echo "🚀 开始打包 BookMarkMap 扩展..."

# 1. 清理旧的构建产物
echo "📦 清理旧的构建产物..."
rm -rf dist/
rm -f bookmark-map.zip

# 2. 构建项目
echo "🔨 构建项目..."
npm run build

# 2.5 审核打包内容（基础合规检查）
echo "🔍 审核打包内容..."
bash scripts/audit-webstore-package.sh

# 3. 检查构建结果
if [ ! -d "dist" ]; then
    echo "❌ 构建失败：dist 目录不存在"
    exit 1
fi

if [ ! -f "dist/manifest.json" ]; then
    echo "❌ 构建失败：manifest.json 不存在"
    exit 1
fi

# 4. 创建 ZIP 包
echo "📦 创建 ZIP 包..."
cd dist
zip -r ../bookmark-map.zip . -x "*.DS_Store" -x "__MACOSX/*"
cd ..

# 5. 验证 ZIP 包
if [ ! -f "bookmark-map.zip" ]; then
    echo "❌ 打包失败：bookmark-map.zip 不存在"
    exit 1
fi

# 6. 显示文件大小
SIZE=$(du -h bookmark-map.zip | cut -f1)
echo "✅ 打包完成！"
echo "📦 文件：bookmark-map.zip"
echo "📏 大小：$SIZE"

# 7. 检查文件大小（Chrome Web Store 限制 5MB）
SIZE_BYTES=$(stat -f%z bookmark-map.zip 2>/dev/null || stat -c%s bookmark-map.zip 2>/dev/null)
MAX_SIZE=$((5 * 1024 * 1024))

if [ $SIZE_BYTES -gt $MAX_SIZE ]; then
    echo "⚠️  警告：文件大小超过 5MB，可能无法上传到 Chrome Web Store"
else
    echo "✅ 文件大小符合要求（< 5MB）"
fi

echo ""
echo "📋 下一步："
echo "1. 访问 https://chrome.google.com/webstore/devconsole"
echo "2. 点击「新增项」"
echo "3. 上传 bookmark-map.zip"
echo "4. 填写商店资料（参考 STORE_SUBMISSION_CHECKLIST.md）"
echo "5. 提交审核"
echo ""
echo "🎉 祝上架顺利！"
