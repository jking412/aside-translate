# AI 翻译服务配置

网页和 YouTube 字幕共用“翻译服务”设置，可从弹窗或独立设置页编辑。各供应商未保存输入会即时保留为本机草稿，切换标签页、关闭弹窗或切换供应商后可以继续；点击“保存服务”才启用。HTTP(S) 网站访问在安装时统一声明，保存服务不再单独请求域名权限。

DeepSeek 与所供原版相同，预填 `deepseek-flash`，下拉提供 `deepseek-flash` / `deepseek-v4-pro`，也可输入自定义模型。常规配置只需自己的密钥；官方地址已填。模型依据核对日期为 2026-11-12，[DeepSeek 官方入门](https://api-docs.deepseek.com/en/) 同时列出这两个标识。其他供应商仍使用用户账户可用的模型 ID，预设不代表服务商合作或全部模型已在线验收。

## 支持的协议

| 协议 | 地址填写方式 | 鉴权与返回 |
| --- | --- | --- |
| OpenAI 兼容 Chat Completions | 完整 `/chat/completions` URL | Bearer 密钥（自托管可空），读取 `choices[0].message.content`，兼容文字数组 |
| Anthropic Messages | 完整 `/v1/messages` URL | `x-api-key`、版本头和浏览器访问头，读取文本 content blocks |
| Google Gemini 原生 | API 基础地址，例如 `https://generativelanguage.googleapis.com/v1beta` | `x-goog-api-key` 头；按单独模型 ID 拼接 `models/...:generateContent`，读取非思考文本 parts |

每段或每句独立请求，翻译结果绑定原始节点或 cue；不会把并发回复按到达顺序拼错。系统提示要求将用户输入视作待翻译文字，仅返回简体中文译文。模型自身可能不遵循提示、误译或添加说明，这不等于输出质量保证。保留原有行/句边界，字幕过期不补播，拖动或换片使旧异步响应失效。Google/Libre 超时12秒，AI超时45秒；网络慢可能错过字幕。拒绝空内容、明确拒绝、工具调用或截断结果，错误不会回显服务商原始响应。

自定义兼容接口不默认指定采样温度、推理参数或 OpenAI token 参数，以减少跨模型不兼容；DeepSeek 官方预设对翻译请求设置 `thinking.type=disabled`，避免默认思考延迟，依据 [Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)。Anthropic 必需的 `max_tokens` 设为4096。富文本段落使用无原始属性的临时行内标记，提示模型保留；返回内容按本段登记的安全元素恢复，不把模型 HTML 直接插入页面。只支持非流式文本翻译，不调用工具、联网搜索、多模态、Responses、Azure 的 api-version、AWS Bedrock 签名或订阅网页登录接口。

## 预设与官方依据

端点按本次官方文档核验。模型标识、余额、区域、套餐和权限以自己的控制台为准；可以编辑预设地址。

| 预设 | 填入的地址 | 官方文档与差异 |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1/chat/completions` | [Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)，各模型支持参数可能不同 |
| DeepSeek | `https://api.deepseek.com/chat/completions` | [API](https://api-docs.deepseek.com/api/create-chat-completion/)，使用当前账户模型 ID |
| 通义千问 · 中国 | `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions` | [百炼兼容接口](https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope)仍保留旧域名兼容；建议在控制台复制业务空间专属域名，避免自行拼错 |
| 通义千问 · 国际 | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions` | 同上；新加坡、美国、香港、日本等地域及业务空间域名不同，API密钥须匹配地域 |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4/chat/completions` | [对话补全](https://docs.bigmodel.cn/api-reference/模型-api/对话补全)，中国站标准 API；国际站和 Coding Plan 可能需要别的端点 |
| Moonshot / Kimi | `https://api.moonshot.cn/v1/chat/completions` | [Chat API](https://platform.kimi.com/docs/api/chat)，国际账户需相应地区地址 |
| 豆包 · 火山方舟 | `https://ark.cn-beijing.volces.com/api/v3/chat/completions` | [Chat API](https://docs.volcengine.com/docs/ark/chat-api?lang=en)，可能使用模型 ID 或自己的推理接入点 ID |
| 硅基流动 | `https://api.siliconflow.cn/v1/chat/completions` | [Chat API](https://docs.siliconflow.cn/docs/api/chat-completions-post)，模型常含组织前缀，国际站域名不同 |
| Mistral | `https://api.mistral.ai/v1/chat/completions` | [Chat API](https://docs.mistral.ai/api/endpoint/chat) |
| Groq | `https://api.groq.com/openai/v1/chat/completions` | [API reference](https://console.groq.com/docs/api-reference) |
| OpenRouter | `https://openrouter.ai/api/v1/chat/completions` | [Chat API](https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request)，模型通常用作者/模型 ID |
| Anthropic Claude | `https://api.anthropic.com/v1/messages` | [Messages](https://platform.claude.com/docs/en/api/messages)、[浏览器认证限制](https://platform.claude.com/docs/en/manage-claude/authentication)，某些组织禁止浏览器直连，即使密钥有效仍可能401 |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta` | [generateContent](https://ai.google.dev/api/generate-content)、[鉴权](https://ai.google.dev/api)，密钥走请求头，不拼进URL |
| 自定义 | 用户自己的接口 | 选择对应协议；HTTPS 或 localhost/127.0.0.1/IPv6 loopback 的 HTTP |

## 密钥和权限

密钥只由用户输入并保存到本机 `chrome.storage.local`；不写入源码、仓库、构建包、日志或同步存储。页面 MAIN world 字幕桥接拿不到密钥。密钥本地未加密，浏览器配置持有人可读取。不要在接口 URL 中放密钥、账号、查询参数或片段；扩展会拒绝这些形式。请求不携带网站 Cookie，禁用自动重定向，避免把自定义请求头带到未确认的跳转地址。

云 API 按服务商规则计费，网页段落和字幕预取可能产生多次请求。自动翻译默认关闭，网站访问已在安装时声明；浏览器扩展详情可限制访问范围。

## 验证范围

单元测试和本地受控 HTTP 服务验证三种协议的请求/响应、鉴权头、逐句对应、并发缓存隔离、超时与401/403/429错误，真实扩展 service worker 和弹窗走同一实现。未使用用户密钥或旧聊天密钥，因此没有执行这些云厂商的付费鉴权调用，未确认各模型在各地域的实际可用性和翻译质量。真实默认公共翻译和真实 YouTube 的单独结果见 [验证记录](verification.md)。
