import type { ProviderType } from "@shared/types/providerConfig"

/**
 * Vendor presets for the provider InstanceEditor.
 *
 * Picking a preset only prefills the form (provider type + base URL, label if
 * empty) and surfaces suggested model ids as the model input's placeholder —
 * nothing about the selection itself is persisted, and the saved config shape
 * is unchanged.
 *
 * Preset data intentionally mirrors the legacy lotus vendor-preset catalog so
 * both frontends stay in sync. Every base URL below was verified against the
 * vendor's OFFICIAL API docs (doc link in the comment next to each entry) and
 * live-probed on 2026-07-11 — do not add guessed URLs.
 */
export interface VendorPreset {
  id: string
  /** Display label(zh-CN,遵循应用内硬编码中文的约定). */
  label: string
  /** Must be a type the backend accepts — presets only use openai/anthropic. */
  provider_type: ProviderType
  base_url: string
  /** Shown as the model input's placeholder — never written into the draft value. */
  suggested_models: string[]
  /** Optional one-line note rendered under the picker. */
  note?: string
}

export const VENDOR_PRESETS: VendorPreset[] = [
  // https://api-docs.deepseek.com/ (verified live 2026-07-10)
  {
    id: "deepseek",
    label: "DeepSeek",
    provider_type: "openai",
    base_url: "https://api.deepseek.com/v1",
    suggested_models: ["deepseek-chat", "deepseek-reasoner"],
  },
  // https://api-docs.deepseek.com/guides/anthropic_api (verified live 2026-07-10)
  {
    id: "deepseek-anthropic",
    label: "DeepSeek (Anthropic 协议)",
    provider_type: "anthropic",
    base_url: "https://api.deepseek.com/anthropic",
    suggested_models: ["deepseek-chat", "deepseek-reasoner"],
  },
  // https://docs.bigmodel.cn/cn/guide/develop/openai/introduction
  {
    id: "zhipu",
    label: "智谱 GLM (bigmodel.cn)",
    provider_type: "openai",
    base_url: "https://open.bigmodel.cn/api/paas/v4",
    suggested_models: ["glm-5.2"],
    note: "Coding Plan 套餐需改用 https://open.bigmodel.cn/api/coding/paas/v4",
  },
  // https://docs.bigmodel.cn/cn/coding-plan/quick-start (ANTHROPIC_BASE_URL)
  {
    id: "zhipu-anthropic",
    label: "智谱 GLM (Anthropic 协议)",
    provider_type: "anthropic",
    base_url: "https://open.bigmodel.cn/api/anthropic",
    suggested_models: ["glm-5.2"],
  },
  // https://docs.z.ai/api-reference/introduction
  {
    id: "zai",
    label: "Z.ai (国际版)",
    provider_type: "openai",
    base_url: "https://api.z.ai/api/paas/v4",
    suggested_models: ["glm-5.2"],
    note: "Coding Plan 套餐需改用 https://api.z.ai/api/coding/paas/v4",
  },
  // https://platform.minimax.io/docs/api-reference/text-openai-api
  {
    id: "minimax",
    label: "MiniMax (国际版)",
    provider_type: "openai",
    base_url: "https://api.minimax.io/v1",
    suggested_models: ["MiniMax-M3"],
  },
  // https://platform.minimaxi.com/docs/api-reference/text-openai-api
  {
    id: "minimax-cn",
    label: "MiniMax (国内版)",
    provider_type: "openai",
    base_url: "https://api.minimaxi.com/v1",
    suggested_models: ["MiniMax-M3"],
  },
  // https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope
  // Alibaba is migrating to per-workspace domains ({WorkspaceId}.cn-beijing.maas.
  // aliyuncs.com); the legacy public domain is documented as "仍可正常使用".
  {
    id: "qwen",
    label: "通义千问 (DashScope)",
    provider_type: "openai",
    base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    suggested_models: ["qwen-plus"],
    note: "阿里云推荐迁移至业务空间专属域名,旧公共域名当前仍可用",
  },
  // https://platform.kimi.com/docs/guide/kimi-k2-5-quickstart
  {
    id: "kimi",
    label: "Kimi (Moonshot)",
    provider_type: "openai",
    base_url: "https://api.moonshot.cn/v1",
    suggested_models: ["kimi-k2.6", "kimi-k2.7-code"],
  },
]
