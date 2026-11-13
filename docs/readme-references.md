# README 结构参考与取舍

调研日期：2026-11-12（Asia/Shanghai）。只参考信息结构，所有旁译文案重新撰写，图片使用本项目自己的截图与原创图标。

## 从 awesome-readme 选择的两个范例

[awesome-readme](https://github.com/matiassingers/awesome-readme#readme) 实际收录了以下两个项目；它是范例目录，不是统一模板。

| 范例 | 观察到的结构 | 适用于旁译的部分 |
| --- | --- | --- |
| [Sniffnet](https://github.com/GyulyVGC/sniffnet#readme) / [下载区](https://github.com/GyulyVGC/sniffnet#download) | 开头提供下载导航和可视化示例；下载区按目标系统给出发布资产链接，深入帮助另链到文档 | 首屏给用途、原创图标与少量有效徽章；直接展示可加载 ZIP，构建放后面。旁译只有一个 Chromium 包，无需复制多系统表格 |
| [GitPoint](https://github.com/gitpoint/git-point#readme) / [构建区](https://github.com/gitpoint/git-point#build-process) | 用户下载入口在前；介绍与截图说明产品；Build Process 留给开发者，并链接贡献说明 | 将下载、加载、两项功能放在源码开发之前；用实际截图让读者知道扩展长什么样 |

不采用两例中的赞助横幅、商店图标、远程图片、庞大徽章组或第三方品牌。GitPoint 的旧构建工具与外链也不适用于本项目。

## 相关翻译扩展的一手参考

- [KISS Translator 安装与快速上手](https://github.com/fishjar/kiss-translator/blob/dev/README.md#安装)：把浏览器安装路径分开，另列服务配置与故障排查。旁译只借其“先安装，再按最短步骤使用”的顺序，不照搬场景关联、多服务能力或高级功能清单。
- [Read Frog 下载区](https://github.com/mengxi-ream/read-frog#download)：将浏览器与实际下载位置对应。旁译应只列已有的 GitHub Release ZIP，不添加尚不存在的 Chrome/Edge 商店链接。
- [沉浸式翻译仓库](https://github.com/immersive-translate/immersive-translate#readme)：首屏列安装、文档、版本下载和反馈；“关于这个仓库”明确其当前软件并非开源、仓库用于发布与反馈。可借入口组织，不能把其发布包或图片当成可自由复用源码和素材。

## 建议的旁译 README 顺序

1. 原创图标、名称、一句话用途；CI、MIT、v0.1.0 预发布状态与下载入口。
2. 下载 ZIP、解压、在 Chrome/Edge 加载已解压扩展的三步说明；安装包不需要 Node.js。
3. 仅两项功能：网页翻译/恢复与自动开关、YouTube 原译分行字幕及其前提。
4. 自有弹窗截图与受控演示截图；每张图写明实际扩展界面或合成输入，不把受控字幕图标成真实 YouTube 验收。
5. 默认公共翻译服务与自备 API 的最小配置；细节链接到 AI 服务文档。
6. 预发布状态及验证表：34 项单元、14 组受控浏览器通过；真实 Google 通过；真实 YouTube 字幕响应为空、双语显示未通过；云 AI 仅协议和受控测试。
7. 权限、文字发送到所选服务、密钥本机存储，链接隐私文档；短列已知限制。
8. 开发构建、自测和打包命令；结构、贡献、许可与完整验证记录链接。

以上测试数字来自本仓库当前 `docs/verification.md`，不是范例仓库的测试结论。发布时应绑定最终提交对应的 CI，避免把历史通过状态套到未验证构建。

## 预发布下载链接

v0.1.0 应链接 [具体版本页](https://github.com/jking412/aside-translate/releases/tag/v0.1.0) 及其 `releases/download/v0.1.0/aside-translate-0.1.0.zip` 资产，发布后实际核对名称和可下载性。

[GitHub 发布文档](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository) 说明预发布用于提示版本尚未就绪、可能不稳定。[最新版本 API](https://docs.github.com/en/rest/releases/releases#get-the-latest-release) 将 latest 定义为非预发布、非草稿版本，因此此阶段不用 `/releases/latest` 作为唯一下载入口。具体版本 URL 的方式见 [链接到 Release](https://docs.github.com/en/repositories/releasing-projects-on-github/linking-to-releases)。

## 素材与许可边界

[Sniffnet](https://github.com/GyulyVGC/sniffnet/blob/main/LICENSE-MIT) 提供 MIT 许可文件，仓库还标示 Apache-2.0；[GitPoint](https://github.com/gitpoint/git-point/blob/master/LICENSE) 使用 MIT。[KISS Translator](https://github.com/fishjar/kiss-translator/blob/dev/LICENSE) 标示 GPL-3.0；[Read Frog](https://github.com/mengxi-ream/read-frog/blob/main/README.md#-contribute) 声明 GPLv3 与商业双重许可。

本次仅借鉴常见章节顺序、下载优先和图片说明方法，没有复制这些项目的段落、HTML 模板、徽章源文件、图标、截图或代码。保留以上出处用于说明编辑思路；如将来实际复用内容或素材，应逐项核对其具体许可与归属，不能因仓库公开或被 awesome-readme 收录就直接使用。

## 推广首页调整（2026-11-13）

参考 [LocalSend](https://github.com/localsend/localsend/blob/main/README.md)、[Immich](https://github.com/immich-app/immich/blob/main/README.md)、[FreeTube](https://github.com/FreeTubeApp/FreeTube/blob/development/README.md) 的产品介绍、截图和主下载入口组织。README 按用途、安装、翻译服务、隐私、常见问题与开发呈现。校验文件保留在 Release，已有测试边界保留在 verification.md。原有 selection-controlled.png 和 subtitles-controlled.png 是合成输入的交互示例，本次首页不再展示；DeepSeek 截图跟随独立服务入口更新。正文不添加在线字幕或云模型真实鉴权的验收结论。
