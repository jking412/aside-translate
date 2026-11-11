# 贡献说明

范围始终只有网页翻译和 YouTube 双语字幕。新增账户、OCR、同步、文档、模型、术语、输入框翻译或站点规则平台需要先讨论范围，不直接增加依赖和权限。

使用 Node.js 22+，执行 `npm ci`、`npx playwright install chromium`、`npm run verify`。网络测试独立运行 `npm run test:online`，PR 说明受控与真实在线结果；失败时提供脱敏状态，不上传浏览器资料、HAR、API 密钥或个人网页内容。

源码按浏览器职责组织。纯协议与字幕时间函数放 shared，页面 DOM 放 content，跨域请求只在 background。更改异步逻辑需覆盖恢复、拖动或换片后的晚到响应；改 UI 时检查键盘操作和小窗口；改图标时编辑 SVG 并重新生成 PNG。不要添加远程可执行代码或未经核实授权的素材。

提交前审查 `git diff --cached --stat` 和 `git diff --cached`；只暂存明确文件。`output`、`dist`、`release`、`node_modules`、`.env` 和测试 profile 必须保持未跟踪。版本号同时更新 package.json、package-lock.json 和 manifest.json。以问题、改动和验证说明 PR。
