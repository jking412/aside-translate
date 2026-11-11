# 本地发布与商店发布

1. 使用干净 checkout，执行 `npm ci`、`npx playwright install chromium`、`npm run verify`。
2. 执行 `npm run test:online`，在自己的网络中访问带字幕的真实 YouTube 视频；验证 CC、人工/自动字幕、暂停/播放/拖动、切片、全屏、缩放和禁用字幕。记录日期、浏览器和明确的未验证范围。
3. 手动从工具栏打开真实 popup；点击翻译、恢复；开启自动翻译并接受授权；新开另一网页确认自动翻译，关闭后确认不再自动翻译。若配置自备服务，验证拒绝授权、错误 URL、错误密钥和断网反馈。
4. 核对 `LICENSE`、`THIRD_PARTY_NOTICES.md`、`PRIVACY.md`，确认所用服务符合自己的发布方式。MIT 覆盖本项目原创部分。
5. 同步三个版本号并记录变更，执行 `npm run build`、`npm run package`。ZIP 直接由 dist 的明确内容构建，不包含源码、依赖、配置或测试资料；核对 ZIP 条目和 SHA-256。
6. 发布 GitHub 前检查 `git status`、`git ls-files` 及暂存 diff，确保没有密钥、个人配置、浏览器资料和未知旧素材。GitHub 仓库为 https://github.com/jking412/aside-translate 。维护者已授权本次交付检查后连接 origin 并推送 main；不要强推，须安全整合远端已有历史。
7. 商店提交还需维护者提供开发者账号、公开隐私政策 URL、图文介绍、真实截图、权限用途说明和支持渠道。根据商店审核反馈调整，不声称真实站点全覆盖或官方合作。GitHub Release 可以上传生成的 ZIP 和 SHA-256，用户解压后加载。

CI 上传的是构建资产，不自动推送、打标签或发布。首次发布后监控平台取轨和公共翻译接口变更，必要时建议使用自备服务。
