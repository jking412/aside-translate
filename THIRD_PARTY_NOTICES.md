# 第三方与来源声明

## 本次独立实现

本仓库的网页翻译、字幕时间轴、播放器生命周期、翻译服务适配、弹窗、图标和构建工具由本次工程独立编写。设计源为 `assets/icon.svg`，各尺寸 PNG 从该源本地生成。测试文字与媒体为人工合成，无旧包媒体复制。

旧工程仅用于只读研究功能要求和已记录的测试结论。参考范围：`sourceCode/docs/youtube-client-parity.md`、`youtube-cue-comparison.md`、播放器证据及相关可读模块。旧工程说明其来源包含对发布客户端的重建，未发现能够为本新项目完整再分发旧业务代码、品牌图标、词级分句规则及内置模型的明确统一许可证。因此本仓库不复制旧业务实现、包内图标、品牌名称、站点规则数据库、分句词表、OCR 模型、vendor 目录、旧测试浏览器资料、配置或服务凭证。MIT 许可仅覆盖本仓库原创内容，不为旧工程或第三方平台授权。

## 仅开发依赖

| 名称 | 固定版本 | 许可证 | 上游 |
| --- | --- | --- | --- |
| esbuild | 0.28.2 | MIT | https://github.com/evanw/esbuild |
| Playwright | 1.65.0 | Apache-2.0 | https://github.com/microsoft/playwright |
| @resvg/resvg-js | 2.6.2 | MPL-2.0 | https://github.com/thx/resvg-js |

传递/平台包由 `package-lock.json` 锁定，许可证随安装包保留在 `node_modules`。这些工具与浏览器二进制不打包进入 `dist` 或发布 ZIP。若未来改变分发方式，应重新核对依赖许可证及通知义务。

## 外部平台和服务

Chrome、Chromium、Edge、YouTube、Google、LibreTranslate 及 AI 服务商 为相关主体的名称/商标。旁译 Aside 是独立工程，没有隶属、赞助或官方认证关系。默认 Google 公共 gtx 接口不是带支持承诺的官方 Cloud Translation API，可能受限制或变更。自备 LibreTranslate 服务不随扩展提供。使用者须遵循所访问平台与服务的适用条款。

协议文档：

- [Chrome 权限](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)
- [Chrome 内容脚本](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [LibreTranslate API](https://docs.libretranslate.com/guides/api_usage/)

AI 服务使用官方文档描述的公开 API 协议，未引入厂商 SDK。端点依据和区域差异见 [AI 服务配置](docs/ai-services.md)。
