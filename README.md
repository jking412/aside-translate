# 旁译 Aside

网页翻译与 YouTube 双语字幕。

只做两件事的轻量 Chromium MV3 扩展：**网页翻译**和 **YouTube 双语字幕**。默认翻译为简体中文，无账户、云同步、本地模型、OCR 或文档处理。原创实现与图标，不包含旧扩展的发布包、品牌素材或站点规则库。

## 构建与加载

需要 Node.js 22+、npm。扩展日常运行不需要 Node、常驻服务或 npm 包。

```powershell
git clone https://github.com/jking412/aside-translate.git
cd aside-translate
npm ci
npm run build
```

打开 `chrome://extensions` 或 `edge://extensions`，开启开发者模式，选择“加载已解压的扩展”，加载本仓库的 `dist` 目录。本次本地交付位置为 `D:\person\immersiveTranslate\dist`。将旁译 Aside固定到工具栏。修改源码并重新构建后，在扩展管理页点击“重新加载”，再刷新已有网页。

## 使用

- 普通 HTTP(S) 网页：点工具栏图标，再点显眼的“翻译此页”；再次点击“恢复原文”。翻译保留 DOM 元素及事件，恢复仅撤销本扩展仍拥有的文字，页面应用之后自己更新的内容不会被旧快照覆盖。
- “自动翻译网页”默认关闭。开启时浏览器会请求所有 HTTP(S) 网页的访问权限，之后新开网页自动翻译；已连接的当前网页也会更新。关闭会停止自动加载脚本，并恢复已连接网页。授予过的浏览器权限可在扩展详情中手动撤销。
- YouTube 双语字幕默认开启。在有字幕的视频上开启播放器 CC；优先使用可读取的 JSON3 时间轴与人工中文轨，没有中文轨时调用所选翻译服务。原文、译文分行，按媒体时钟显示，随播放器尺寸缩放，拖动和换片清理旧字幕。
- 只有屏幕当前字幕可读时，采用 DOM 回退并显示提示：无法预译未来字幕，网络慢时可能缺少译文。无字幕轨的视频不会从音频生成文字。
- “翻译服务”折叠区默认 Google 公共服务，无需密钥；这是非官方公共 gtx 接口，无可用性承诺，可能在当前网络不可达、限流或变更。可改为自备 LibreTranslate、OpenAI 兼容、Anthropic Messages 或 Gemini 原生接口；网页和字幕共用同一配置。OpenAI、DeepSeek、通义千问、智谱、Moonshot、豆包、硅基流动、Mistral、Groq、OpenRouter 等提供端点预设，模型 ID 由用户填写。详见 [AI 服务配置与官方文档](docs/ai-services.md)。HTTPS 接口或本机 HTTP；首次保存时仅请求该服务的域名访问权限。

**翻译文字会发送到所选服务。** 自动翻译可能发送网页中的可见文字，包括个人信息，请只在认可的网页上使用。设置和自备密钥只保存在本机 `chrome.storage.local`，不使用同步存储。详见 [隐私说明](PRIVACY.md)。

## 自测与调试

```powershell
npm ci
npx playwright install chromium
npm run verify
npm run test:online
npm run package
```

如已安装独立测试用 Chromium，可设置环境变量 `ASIDE_CHROMIUM_PATH` 为其可执行文件绝对路径；不使用个人浏览器资料。

`verify` 包括语法、权限和 PNG 尺寸检查、Node 单元测试、构建及隔离 Chromium 受控浏览器测试。CI 使用固定版本的官方 Playwright Linux 容器运行相同验证并生成 ZIP。`test:online` 单独探测真实 Google 和公开视频页面，网络失败会记录为未通过，不能把受控测试当成真实服务验收。截图、诊断、临时媒体和独立测试浏览器资料保存在已忽略的 `output/`，不会进入 Git 或发布包。

从扩展管理页查看 service worker 控制台；网页 DevTools 的内容脚本环境查看运行错误。弹窗右键“检查”查看 popup。不要把带密钥的截图、存储导出、浏览器资料或网络日志提交到仓库。此工程不记录翻译正文或密钥日志。

## 结构

| 目录 | 职责 |
| --- | --- |
| `src/background` | 请求队列、翻译服务、自动内容脚本注册 |
| `src/content/page.js` | 可恢复网页翻译和动态内容 |
| `src/content/youtube*.js` | 窄范围播放器桥接、字幕生命周期与布局 |
| `src/shared` | 本地配置、服务协议、字幕时间轴纯函数 |
| `src/popup` | 两项功能开关、一键操作、折叠服务配置 |
| `assets/icon.svg` | 原创图标的唯一设计源文件 |
| `tools` / `tests` | 构建、确定性图标、单元和浏览器验证、发布打包 |

零运行时 npm 依赖。esbuild、Playwright、resvg 仅用于开发，不随扩展分发。图标编辑后运行 `npm run icons`，构建也会重新生成 16/32/48/128 PNG。设计理由见 [图标与界面](docs/design.md)。

## 已知边界

桌面 Chrome/Edge 120+ 为目标，实际验证浏览器及结果见 [验证记录](docs/verification.md)。不支持浏览器内部页面、扩展商店、PDF、封闭 Shadow DOM、跨域 iframe、画布内文字或无字幕音频。网页翻译以可见文本节点为单位，复杂内联排版的片段译文可能缺少上下文；不会翻译输入框、代码块或播放器区域。YouTube 可能改变播放器结构、轨道鉴权和字幕返回格式；广告、直播、地区/账号差异需真实站点复测。没有复制旧包专有英文分句规则，不声称与其逐句等价。

## 发布

`npm run build` 后运行 `npm run package`，得到 `release/aside-translate-0.1.0.zip` 与 SHA-256。ZIP 根目录包含 manifest，可直接作为发布资产；`dist/` 可解压加载。发布前完成 [发布清单](docs/release.md)。GitHub 仓库：[jking412/aside-translate](https://github.com/jking412/aside-translate)。发布包名为 aside-translate-版本号.zip。

原创源码与图标采用 [MIT](LICENSE)。开发依赖与旧素材授权检查见 [第三方声明](THIRD_PARTY_NOTICES.md)。欢迎按 [贡献说明](CONTRIBUTING.md) 提交改动。
