# Contributing

感谢你愿意贡献代码！

## 开发环境
- Node.js：建议使用 LTS（例如 Node 20）
- 包管理：npm（本仓库使用 `package-lock.json`）

## 本地开发
```bash
npm install
npm run dev
```

然后在 Chrome 打开 `chrome://extensions/` → 开启开发者模式 → 「加载已解压的扩展程序」选择 **`dist/`**。

> ⚠️ 不要直接加载仓库根目录；Chrome 只能加载构建产物 `dist/`。

## 构建检查
```bash
npm run build
```

## 提交内容建议
- 功能改动请附带简短说明与截图（尤其是 UI 变化）
- 影响权限（manifest 权限/联网行为）请更新 `privacy.md` / README 说明
- 大改动建议先开 Issue 讨论，避免返工

