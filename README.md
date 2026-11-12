<p align="center">
  <img src="assets/icon-128.png" alt="旁译 Aside 原创图标" width="80" height="80">
</p>

<h1 align="center">旁译 Aside</h1>

<p align="center">网页翻译与 YouTube 双语字幕。默认中文，只保留阅读需要的两项功能。</p>

<p align="center">
  <a href="https://github.com/jking412/aside-translate/actions/workflows/ci.yml"><img src="https://github.com/jking412/aside-translate/actions/workflows/ci.yml/badge.svg?branch=main" alt="构建与测试"></a>
  <a href="https://github.com/jking412/aside-translate/releases/tag/v0.1.0"><img src="https://img.shields.io/badge/版本-v0.1.0%20预发布-blue" alt="v0.1.0 预发布"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/许可证-MIT-green" alt="MIT 许可证"></a>
</p>

<p align="center">
  <a href="#下载安装">下载安装</a> · <a href="#功能">功能</a> · <a href="#界面预览">界面预览</a> · <a href="#翻译服务">翻译服务</a> · <a href="#验证状态">验证状态</a> · <a href="#开发">开发</a>
</p>

旁译是原生 JavaScript 编写的轻量 Chromium MV3 扩展，无账户和云同步，运行时没有 npm 依赖，也无需常驻 Node 服务。

> **预发布说明：** 网页翻译及受控字幕测试已通过；本次真实 YouTube 字幕接口返回空正文，真实双语字幕显示尚未验收通过。v0.1.0 适合试用和反馈，具体范围见[验证状态](#验证状态)。

## 下载安装

安装包解压后即可加载，**使用扩展不需要安装 Node.js**。

| 下载 | 用途 |
| --- | --- |
| [下载旁译 v0.1.0 扩展 ZIP](https://github.com/jking412/aside-translate/releases/download/v0.1.0/aside-translate-0.1.0.zip) | Chrome / Edge 等桌面 Chromium 浏览器，共用一个包 |
| [下载 SHA-256 校验文件](https://github.com/jking412/aside-translate/releases/download/v0.1.0/aside-translate-0.1.0.zip.sha256) | 校验 ZIP 文件完整性 |
| [查看版本说明与已知限制](https://github.com/jking412/aside-translate/releases/tag/v0.1.0) | v0.1.0 预发布页面 |

1. 下载上表 ZIP，解压到固定文件夹；文件夹内应直接包含 `manifest.json`。
2. Chrome 打开 `chrome://extensions`，Edge 打开 `edge://extensions`，开启“开发者模式”。
3. 选择“加载已解压的扩展”，选中解压后的文件夹；将旁译固定到工具栏，刷新准备翻译的网页。

更新时解压新包，在扩展管理页重新加载，再刷新已有网页。GitHub 自动生成的 **Source code** 是源码包，需要按[开发说明](#开发)构建后使用。目前未上架 Chrome / Edge 商店。

## 功能

| 功能 | 使用方式 |
| --- | --- |
| **网页翻译** | 点击工具栏图标，再点“翻译此页”；再次点击“恢复原文”。可开启自动整页翻译，动态新增文字也会处理。 |
| **YouTube 双语字幕** | 在有字幕的视频上开启播放器 CC。读取可用字幕轨，按媒体时钟显示原文与中文两行；随播放器缩放，拖动、换片和关闭时清理旧字幕。 |

网页翻译保留页面元素和事件。恢复时仅撤销扩展仍拥有的文字，页面应用后来更新的内容不会被旧快照覆盖。输入框、代码块和播放器区域不参与网页翻译。

字幕优先使用匹配的人工中文轨；缺少中文轨时调用所选翻译服务。完整时间轴不可读时，尝试翻译播放器当前字幕，无法预译未来内容；接口慢时可能缺少译文。无字幕轨的视频不会从音频生成文字。

## 界面预览

<table>
  <tr>
    <td align="center"><img src="docs/images/popup.png" alt="旁译默认弹窗：翻译按钮、自动翻译和双语字幕开关、折叠服务配置" width="300"></td>
    <td align="center"><img src="docs/images/subtitles-controlled.png" alt="受控视频中的原文与中文分行字幕演示" width="640"></td>
  </tr>
  <tr>
    <td>默认弹窗，配置保持折叠。</td>
    <td>合成视频、人工双语输入的受控字幕演示。</td>
  </tr>
</table>

以上均为本项目自己的截图：弹窗图使用受控 Chrome API 替身；字幕图来自加载真实构建的隔离浏览器，输入是合成数据。**字幕演示图不代表真实 YouTube 在线验收成功。** 原创图标的 [SVG 源文件](assets/icon.svg) 与多尺寸 PNG 均随仓库提供。

## 翻译服务

网页和字幕共用一个“翻译服务”设置。展开弹窗底部的配置区，选择服务、填入自己的接口和密钥后保存。

| 服务 | 配置 |
| --- | --- |
| Google 公共服务 | 默认，无需密钥；非官方公共 gtx 接口，可用性取决于网络和服务限制 |
| LibreTranslate | 自备完整 `/translate` URL，密钥可选 |
| OpenAI 兼容 | 提供 OpenAI、DeepSeek、通义千问、智谱、Moonshot、豆包、硅基流动、Mistral、Groq、OpenRouter 端点预设，也可自定义接口 |
| Anthropic Messages | 原生协议，自备接口、模型 ID 和密钥 |
| Google Gemini | 原生 generateContent 协议，自备 API 基址、模型 ID 和密钥 |

AI **模型 ID 由用户填写**，不内置容易过期的模型列表。各服务的地区端点、套餐、模型权限和计费可能不同，详见 [AI 服务配置与官方依据](docs/ai-services.md)。

## 权限与隐私

- 自动网页翻译默认关闭；开启时再申请所有 HTTP(S) 网页访问权限。关闭后停止自动加载并恢复已连接网页，已授予的浏览器权限可在扩展详情中撤销。
- 手动网页翻译使用当前标签页授权；YouTube 内容脚本仅匹配 `www.youtube.com`；自备服务保存时只请求相应域名权限。
- **文字会发送到所选翻译服务。** 自动翻译可能发送页面中的个人信息；在敏感页面使用前，请先确认是否允许发送。
- 设置与密钥仅存本机 `chrome.storage.local`，不启用同步，不持久化网页正文；密钥在本地未加密。AI 请求可能产生服务商费用。

完整说明见 [隐私说明](PRIVACY.md)。扩展不包含 OCR、语音模型、文档处理、术语库、账户和同步模块。

## 验证状态

| 范围 | 本次结果 |
| --- | --- |
| 单元测试 | **34 项通过**：协议、限流、超时、并发对应、缓存、字幕时间轴和生命周期 |
| 隔离浏览器受控测试 | **14 组通过**，页面脚本错误为 0；本地 Chromium 143、CI Chromium 158 |
| 真实 Google 公共翻译 | 通过；扩展后台实际返回“你好世界。” |
| 真实 YouTube | 页面、播放、拖动、缩放通过；字幕响应正文为 0，双语字幕显示**未通过** |
| 云 AI 真实鉴权调用 | 未执行；已核验官方协议，并通过单元和本机 HTTP 受控测试 |
| 原生工具栏与授权对话框 | 仍需手动检查；桌面工具绑定失败，受控测试预授予权限的边界已注明 |

目标为桌面 Chrome / Edge 120+，120 和 Edge 尚未单独实测。不支持浏览器内部页、扩展商店、PDF、封闭 Shadow DOM、跨域 iframe 和画布文字。复杂内联网页可能缺少翻译上下文；广告、直播和地区/账号差异需进一步验证。

完整证据、复现方法及已知限制见 [验证记录](docs/verification.md)；构建状态见 [GitHub Actions](https://github.com/jking412/aside-translate/actions)。

## 开发

需要 Node.js 22+ 与 npm。

```shell
git clone https://github.com/jking412/aside-translate.git
cd aside-translate
npm ci
npm run build
```

构建输出为 `dist/`，按前面的步骤加载。只修改源码后需要重新构建、重新加载扩展并刷新网页。

```shell
npx playwright install chromium
npm run verify
npm run package
```

`verify` 包含语法/权限/图标检查、单元测试、构建和隔离浏览器测试。真实网络探测单独运行 `npm run test:online`，无真实双语字幕时返回非零。已有独立 Chromium 时，可将 `ASIDE_CHROMIUM_PATH` 设为其可执行文件绝对路径。CI 使用固定版本官方 Playwright 容器。

| 目录 | 职责 |
| --- | --- |
| `src/background` | 翻译请求、队列和自动脚本注册 |
| `src/content` | 网页翻译、播放器桥接和字幕显示 |
| `src/shared` | 配置、服务协议、字幕时间轴与服务预设 |
| `src/popup` | 中文弹窗和最小配置 |
| `assets` | 原创图标源与各尺寸 PNG |
| `tools` / `tests` | 构建、验证与打包 |

`npm run package` 在 `release/` 生成扩展 ZIP 和 SHA-256。发布流程见 [发布说明](docs/release.md)。测试原始输出、临时媒体、测试浏览器资料、密钥配置、`node_modules`、`dist` 和 `release` 均不进入 Git；README仅收录已审查的自有演示图片。

## 贡献与许可

欢迎提交问题和改进建议，见 [贡献说明](CONTRIBUTING.md)与[问题反馈](https://github.com/jking412/aside-translate/issues)。原创代码和图标采用 [MIT](LICENSE)，第三方工具及旧素材授权检查见 [第三方声明](THIRD_PARTY_NOTICES.md)。

README 的信息结构参考 [awesome-readme](https://github.com/matiassingers/awesome-readme) 收录的 Sniffnet、GitPoint，以及相关翻译扩展的安装文档；仅借鉴章节组织，文字与图片均来自本项目。选取理由和来源见 [README 结构参考](docs/readme-references.md)。
