// Reviewed official endpoints and a small provider default; see docs/ai-services.md. Never embed keys.
export const PROVIDER_PRESETS = Object.freeze([
  {
    "id": "custom",
    "name": "自定义兼容服务",
    "service": "openai",
    "endpoint": "",
    "help": "填写服务商提供的完整接口地址；本机可用 HTTP。"
  },
  {
    "id": "openai",
    "name": "OpenAI",
    "service": "openai",
    "endpoint": "https://api.openai.com/v1/chat/completions",
    "help": "填写账户可用的 Chat Completions 文本模型 ID。"
  },
  {
    "id": "deepseek",
    "name": "DeepSeek",
    "service": "openai",
    "endpoint": "https://api.deepseek.com/chat/completions",
    "defaultModel": "deepseek-flash",
    "models": ["deepseek-flash", "deepseek-v4-pro"],
    "modelsCheckedAt": "2026-11-12",
    "modelDocs": "https://api-docs.deepseek.com/en/",
    "help": "默认 deepseek-flash；可选 deepseek-v4-pro 或自定义。模型名称已于 2026-11-12 核对官方文档。"
  },
  {
    "id": "qwen-cn",
    "name": "通义千问 · 中国",
    "service": "openai",
    "endpoint": "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    "help": "预填官方仍兼容的旧域名；建议按百炼控制台改为业务空间专属端点，密钥须匹配地域。"
  },
  {
    "id": "qwen-intl",
    "name": "通义千问 · 国际",
    "service": "openai",
    "endpoint": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
    "help": "国际/新加坡兼容端点；建议改成控制台业务空间专属端点，密钥须匹配地域。"
  },
  {
    "id": "zhipu",
    "name": "智谱 GLM",
    "service": "openai",
    "endpoint": "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    "help": "中国站标准 API；Coding Plan 与国际站地址可能不同，请按自己的套餐修改。"
  },
  {
    "id": "moonshot",
    "name": "Moonshot / Kimi",
    "service": "openai",
    "endpoint": "https://api.moonshot.cn/v1/chat/completions",
    "help": "中国站 API；国际账户须使用对应地区端点与密钥。"
  },
  {
    "id": "doubao",
    "name": "豆包 · 火山方舟",
    "service": "openai",
    "endpoint": "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
    "help": "按方舟控制台填写模型 ID 或推理接入点 ID，地域和套餐端点可能不同。"
  },
  {
    "id": "siliconflow",
    "name": "硅基流动",
    "service": "openai",
    "endpoint": "https://api.siliconflow.cn/v1/chat/completions",
    "help": "模型 ID 可能包含组织/模型前缀；国际站请改为自己的端点。"
  },
  {
    "id": "mistral",
    "name": "Mistral",
    "service": "openai",
    "endpoint": "https://api.mistral.ai/v1/chat/completions",
    "help": "填写支持 chat/completions 的文本模型 ID。"
  },
  {
    "id": "groq",
    "name": "Groq",
    "service": "openai",
    "endpoint": "https://api.groq.com/openai/v1/chat/completions",
    "help": "填写 Groq 账户当前可用的模型 ID。"
  },
  {
    "id": "openrouter",
    "name": "OpenRouter",
    "service": "openai",
    "endpoint": "https://openrouter.ai/api/v1/chat/completions",
    "help": "模型通常使用作者/模型 ID；可用性与计费取决于提供商。"
  },
  {
    "id": "anthropic",
    "name": "Anthropic Claude",
    "service": "anthropic",
    "endpoint": "https://api.anthropic.com/v1/messages",
    "help": "Messages 原生协议。需自己的 API 密钥；部分组织禁止浏览器直连。"
  },
  {
    "id": "gemini",
    "name": "Google Gemini",
    "service": "gemini",
    "endpoint": "https://generativelanguage.googleapis.com/v1beta",
    "help": "原生 generateContent；这里只填 API 基址，模型 ID 单独填写。"
  }
]);
