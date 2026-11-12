# 发布流程

当前版本为 [v0.2.1 预发布](https://github.com/jking412/aside-translate/releases/tag/v0.2.1)。预发布期间使用具体版本链接，不能依赖排除预发布的 `/releases/latest`。

## 发布前

1. 确认工作区干净，检查完整暂存清单，运行 `npm run audit:staged`。密钥、个人配置、测试profile、未知旧素材和生成目录不得入库。
2. 同步 `package.json`、`package-lock.json`、`manifest.json` 版本号，编写 `docs/releases/v版本号.md`，更新README的下载链接与已知限制。
3. 执行 `npm ci`、`npx playwright install chromium`、`npm run verify`，并单独运行 `npm run test:online`。记录受控结果与真实网络结果；网络字幕未通过时维持预发布状态。
4. 检查真实工具栏、悬浮入口、翻译/恢复、新开网页、iframe、字幕播放/拖动/换片/缩放；确认配置中途切页和关闭弹窗不丢输入。安装或升级权限由浏览器统一提示，核心功能和保存接口不得再调用 permissions.request。
5. 核对MIT、第三方声明、隐私说明、所用服务条款。商店上架另需开发者账号、公开隐私政策URL、介绍与真实截图。

## GitHub Release

GitHub仓库为 [jking412/aside-translate](https://github.com/jking412/aside-translate)。当前工作流仅自动发布 **`v0.*` 早期版本标签**，全部标记为预发布；稳定版发布策略需要另行明确后更新。

1. 提交并推送通过审查的main，创建与包版本一致的标签（如 `v0.2.1`），然后推送该标签，不移动已公开标签、不强推。
2. `Verify extension` 工作流在标签提交上重新运行完整受控验证并构建ZIP。发布任务依赖验证任务成功，仅该任务具有 `contents: write` 权限。
3. 发布任务下载本次构建产物，检查标签/版本/发布说明，运行 `sha256sum -c`，以仓库内的说明文件创建草稿并上传ZIP和校验文件。确认两个附件已上传后，再公开为预发布。
4. 若同名Release已存在，创建步骤会失败，不会自动覆盖已公开附件；检查实际状态后再处理，避免把不同构建混入同一版本。
5. 发布后核对标签指向、Release公开/预发布状态、两个附件名、大小、摘要及下载链接。安装包根目录应直接包含manifest，不能带源码、node_modules或测试资料。

工作流使用GitHub自动提供的短期令牌，不需要提交个人Token或密钥。依据 [GitHub CLI发布命令](https://cli.github.com/manual/gh_release_create)与[工作流中的GitHub CLI](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-github-cli)。

本地手动打包可运行 `npm run build`、`npm run package`，输出 `release/aside-translate-版本号.zip` 及 `.sha256`。发布附件以该标签CI验证后的构建为准。
