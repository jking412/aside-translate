# v0.2.0 原版行为对照

本轮直接对照用户提供的沉浸式翻译 1.34.4 发布包 `extension/`，不把此前 `sourceCode/` 重建的行为当作原版。日期：2026-11-12。原包始终只读，旁译代码、样式、图标和分句逻辑独立编写。

## 已确认的原版行为与 v0.1.0 差异

| 范围 | 原版发布包证据 | v0.1.0 问题 | v0.2.0 实现 |
| --- | --- | --- | --- |
| 网页输出 | `default_config.json`: `translationMode=dual`、`translationPosition=after`；`content_main.js` 的 Np/t1/I9/LN 段落、序列化和布局路径 | 每个 Text 单独翻译并直接替换原文，内联句子被拆散 | 保留源 DOM、整段翻译，在原文后显示中文；短行行内、长段另起一行 |
| 网页调度 | `content_main.js` QQe/YQe 路径使用 IntersectionObserver | 扫描并请求整页所有文本 | 视口附近优先，滚动与动态段落继续处理；恢复只删除扩展译文 |
| 字幕入口 | `video-subtitle/inject.js` 的 `xhr_response` hook 与 `triggerSubtitle` | 只根据 metadata 中的 baseUrl 直接 fetch，没有原生回包路径、没有主动 CC | 捕获当前视频原生 timedtext 回包，自动触发 CC，并保留直接读轨与屏幕回退 |
| 字幕语义和时钟 | 原包 preTranslation 默认开启，ASR 使用词级时刻整理句子；显示按播放器时间 | 简单合并 events，缺少词级分句，前瞻较短 | 独立词级分句、预取、媒体时钟与 seek/navigation 失效处理 |
| 字幕服务 | `content_main.js` 的 subtitleTranslateService 继承当前服务；人工中文优先默认开启 | 服务与人工轨分支不清晰 | 默认优先人工中文；无人工中文或关闭优先时使用所选服务 |
| 默认公共服务 | `default_config.json`: `translationService=bing`；`background.js` Microsoft provider 使用 Edge 公共 POST | 只有默认 Google gtx | 新安装默认微软，无密钥；保留已保存的服务选择 |
| DeepSeek 配置 | `translationServices.deepseek`: model=`deepseek-flash`、models=`deepseek-flash\|deepseek-v4-pro`；options.js 将其拆为下拉 | 预设只填地址，强制从零输入模型 | 地址与默认模型预填，可选另一个模型或自定义 |
| 配置页 | manifest 的 options_page；options.js 编辑控件通过变更保存；popup 有设置入口 | 所有输入只在 popup 中且仅提交保存，切页丢失 | 持久设置标签页、逐供应商本机草稿与明确激活操作 |
| 悬浮入口 | `content_main.js` Tve/En/Zlt：拖动、吸边、位置保存、翻译动作 | 无悬浮入口 | 旁译原创球形入口，拖动吸边、位置恢复、快捷面板与设置入口 |
| 权限 | 原 manifest `host_permissions=["<all_urls>"]`，网页脚本覆盖普通网站 | auto 和自备接口运行时申请可选权限 | HTTP(S) 权限安装时声明，核心动作不调用 permissions.request |

浏览器仍可在安装或升级增加权限时显示确认；扩展无法取消浏览器本身的安全告知。此处恢复的是原版“安装后使用功能不再逐次申请”的行为，参见 [Chrome 权限声明](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)。

## 来源指纹

以下为本次读取文件的 SHA-256，便于确认对照版本；原版文件不随本仓库分发。

| 原包文件 | SHA-256 |
| --- | --- |
| manifest.json | bc692e591d5d0e1bf7fbd4073b0425757e19beb79d916fbb93e9c06fb519b666 |
| default_config.json | f8f1452d56ab2d035072e2158f14faa88ab83eafa4f21e052ac5c950d86a2cc8 |
| content_main.js | 26a5ab8126206ab45f260052c491657176814930b8d2e3edfd2605fa3280dc60 |
| background.js | 38a67b1dc09bb6e72fd00902924eeda61d8e07632a92fff14b24cb99f94e1f13 |
| options.js | 5acebde41ec6a1ca2ae034fe1f170c2cdd8dc579f6f48a2bab21ff02644a8e55 |
| video-subtitle/inject.js | 1a432baf084af6bbc797d9e5539574dd9efd0decb6e1266546f3346e5ed770b8 |

## 检查入口

`tools/page-parity-test.mjs`、`tools/ui-parity-test.mjs`、`tools/youtube-parity-test.mjs` 先在旧实现实际失败，再验证同一场景的修复。`tools/browser-test.mjs` 使用正式 manifest 和构建，不再通过预授予权限的副本替代交付包。真实网络另由 `npm run test:online` 采样。结果、未通过范围和在线限制见 [验证记录](verification.md)。

对照覆盖这两项核心功能及其入口和配置。原版的账户、收费后台、OCR、文档、术语库和私有站点规则库不属于本项目，也没有从旧包复制；有限样例通过不能推广为所有网站与所有视频逐像素等价。

关闭预先翻译时仅请求当前句，不请求未来句；没有人工中文轨时仍使用用户所选服务，不因关闭预取而改用平台机器译轨。原版的末词零时长缺陷另按有效 event duration 修正，详情见验证记录。
