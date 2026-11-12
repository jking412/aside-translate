# v0.2.0 验证记录

日期：2026-11-12，Asia/Shanghai。默认本机测试浏览器为隔离 Chromium 143.0.7499.4，固定开发依赖与 package-lock.json 一致。不使用个人浏览器资料、账号 Cookie、历史密钥或计费云 AI。

## 结果与边界

| 范围 | 本次实际结果 |
| --- | --- |
| 源码、协议与时钟单元测试 | 60 项通过；由 npm run verify 运行，涵盖段落拆分、模型协议、格式缓存隔离、ASR、人工轨、超时、并发、拖动、倍速、关闭预取和换片 |
| 正式扩展浏览器验收 | 17 组通过，页面脚本错误为 0；直接加载正式 manifest，不添加预授权或改写 host permissions |
| 专项差异回归 | 网页 8 组、设置/悬浮入口 9 组、YouTube 7 组通过；这些明确区分 Chrome API 替身和真实扩展入口 |
| 原版网页同输入对照 | 实际加载原包 1.34.4 副本；原文、整段 inline、链接身份、事件、滚动后加载和恢复的观察相符 |
| 原版字幕函数同输入对照 | 在隔离 VM 中运行原包实际函数；比较 9 份原创公共格式输入、35 句；末句时长缺陷有意修正，详见下文 |
| 真实微软翻译 | 真实 service worker 返回“你好，世界。”；Read / i1 标记富文本返回中文且保留标记 |
| 真实 YouTube | 新版与原版在同一公开视频、同样独立浏览器条件下均收到空字幕正文，均没有可见双语字幕；在线字幕验收未通过 |
| 云 AI 真实调用 | 未执行付费鉴权请求；三种协议通过单元测试及真实 service worker 到本机 HTTP 服务的验证 |

完整主检查运行 `npm run verify`，真实网络单独运行 `npm run test:online`；本次后者返回 1，不能以视频播放成功替代字幕成功。

## 已复现再修复的差异

v0.1.0 的实际失败包括：网页原文被替换、同段 strong/link 被拆为多次请求、离屏内容立即发起请求；DeepSeek 默认模型为空、关闭 popup 丢输入、切换供应商串稿、持久设置页缺失；普通网页访问属于运行时可选权限；以及 metadata 字幕 URL 返回空时，没有播放器原生 XHR/fetch 路径。

同一检查在本版转绿。随后整体验收又发现并修复独立 code 被纳入段落、popup 状态来自任意子 frame、主页面恢复时新 frame 反而开启、继承来源 frame 请求被拒绝、多个配置窗口覆盖旧字段等组合问题。

正式包还实际验证：未保存 DeepSeek 草稿在 popup 文档销毁后仍由 chrome.storage.local 恢复；openOptionsPage 打开独立标签页，重载保留输入且未激活未保存服务。独立 UI 专项使用 API 替身，不把它冒充原生 popup 或安装权限对话框；实际存储和扩展设置入口另由正式包用例覆盖。

## 原版直接对照

来源文件指纹与读取位置见 [原版对照](parity.md)。原目录始终只读，加载副本均置于被忽略的 output，未复制原版业务代码或站点规则到交付包。

网页：原包与本版使用同一份合成 HTML，fixture SHA-256 为 e4d5a2ecb362746d40503a4502ed8a7b31b867728434fdb9f51cb7007396704f。原包实际整段请求 Read / strong / a 内容，源节点和链接保持身份；5000px 外段落初始未请求，滚动靠近后出现译文；恢复 target 数为 0，原链接事件触发仍为 1。远程连接被测试代理阻断，只访问本机人工翻译结果，因此这证明渲染和调度，不能证明在线翻译质量。短 H1 在原包该 custom 服务路径中被判 same_text 而未生成译文，没有宣称这项运行等价；短行布局参考原包静态规则并在本版单独验证。

字幕：9 份人工输入通过原包实际函数核验，包括词级停顿、填充词、标点、长段、大写、普通轨重叠、多行和日语。分句文字与起点作为对照；原包会将最后一组结束时刻退到最后一个词的起点，单词 ASR 可能形成零时长。旁译保留有效 event duration，确保末句可以显示；这项是明确记录的修正，不再以所有起止时刻逐项相同作为验收标准。

可复跑命令：

```powershell
$env:ASIDE_CHROMIUM_PATH='你的独立 Chromium 可执行文件绝对路径'
$env:ASIDE_ORIGINAL_EXTENSION='你持有的原版 1.34.4 目录绝对路径'
node tools/page-parity-test.mjs --original
node tools/youtube-parity-test.mjs --original $env:ASIDE_ORIGINAL_EXTENSION
```

默认 CI 不依赖这份原包或机器目录；只运行仓库内原创合成输入与断言。原包对照报告在 output/page-parity/original.json 和 output/youtube-parity/original-cue-comparison.json，不随仓库和安装包分发。

## 真实网络采样

正式构建访问微软公共接口，Hello world. 返回“你好，世界。”；`Read <i1>the documentation</i1> before you start.` 的 HTML 模式返回 `开始前<i1>请阅读相关文档</i1>。`，有效标记保留。记录位于 output/parity/default-service-real.json，仅人工测试句。

公开视频为 [3Blue1Brown 的神经网络入门](https://www.youtube.com/watch?v=aircAruvnKk)，无响应替换：

- 本版 HTTP 200，播放器播放推进、拖动至 30 秒后继续；识别英语音轨 en-US，自动触发 CC。记录的 6 个英语/简中 timedtext 响应均 HTTP 200、正文字符数 0；原生 CC 和扩展原译两行均为空。
- 原版 1.34.4 同视频、同机独立 profile 对照：injectReady 为 true，播放器原版快捷按钮存在，CC 为开启且请求了英语。媒体时钟约 3.93→7.97 秒，拖动后 30.96→37.01 秒；6 个 timedtext 响应同样 HTTP 200、正文字符数 0；原生 CC 和原版译文均为空。
- 本轮无法从空响应判定具体原因，也不能外推所有账号或地区。结果证明同条件原版也未获得有效字幕，不证明本版真实字幕在线通过。

证据在 output/online/report.json、original-report.json 及截图。记录只保留语言、状态码、正文长度、轨事件数和屏幕文字，不保留完整签名 URL、Cookie 或凭据。该限制写入预发布说明。

## 发布包与未验证范围

构建只包含运行代码、原创图标与许可/隐私说明，不含原包、测试媒体、源码测试、node_modules、profile 或配置导出。发布 CI 重新构建并校验 ZIP 与 SHA-256，公开附件按实际下载再核对。

声明目标桌面 Chrome / Edge 120+；本机实际测试 Chromium 143，CI 使用锁定 Playwright 官方容器的 Chromium。未单独声称 Chrome120、Edge、原生商店安装、全部地区/账号、广告、直播、所有复杂站点或云 AI 模型通过。浏览器内部页、商店、PDF、封闭 Shadow DOM 和画布文字不参与网页翻译；原版私有站点规则库未复制，超长或丢失格式的译文会安全降为纯文本。

v0.1.0 的历史验证保留在 [旧标签的记录](https://github.com/jking412/aside-translate/blob/v0.1.0/docs/verification.md)。本文件只说明本次结果。
