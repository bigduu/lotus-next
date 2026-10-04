import { uiText } from "@shared/i18n/ui"
import type { ProviderKind } from "@shared/types/providerConfig"

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
  provider_type: ProviderKind
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
    get label() { return uiText("deepseek_anthropic_protocol_62842c32") },
    provider_type: "anthropic",
    base_url: "https://api.deepseek.com/anthropic",
    suggested_models: ["deepseek-chat", "deepseek-reasoner"],
  },
  // https://docs.bigmodel.cn/cn/guide/develop/openai/introduction
  {
    id: "zhipu",
    get label() { return uiText("zhipu_glm_bigmodel_cn_a240ba1c") },
    provider_type: "openai",
    base_url: "https://open.bigmodel.cn/api/paas/v4",
    suggested_models: ["glm-5.2"],
    get note() { return uiText("coding_plan_subscriptions_must_use_https_open_bigmodel__3219dd7a") },
  },
  // https://docs.bigmodel.cn/cn/coding-plan/quick-start (ANTHROPIC_BASE_URL)
  {
    id: "zhipu-anthropic",
    get label() { return uiText("zhipu_glm_anthropic_protocol_3615b3ca") },
    provider_type: "anthropic",
    base_url: "https://open.bigmodel.cn/api/anthropic",
    suggested_models: ["glm-5.2"],
  },
  // https://docs.z.ai/api-reference/introduction
  {
    id: "zai",
    get label() { return uiText("z_ai_international_e13ea359") },
    provider_type: "openai",
    base_url: "https://api.z.ai/api/paas/v4",
    suggested_models: ["glm-5.2"],
    get note() { return uiText("coding_plan_subscriptions_must_use_https_api_z_ai_api_c_5de1ae0c") },
  },
  // https://platform.minimax.io/docs/api-reference/text-openai-api
  {
    id: "minimax",
    get label() { return uiText("minimax_international_6474afda") },
    provider_type: "openai",
    base_url: "https://api.minimax.io/v1",
    suggested_models: ["MiniMax-M3"],
  },
  // https://platform.minimaxi.com/docs/api-reference/text-openai-api
  {
    id: "minimax-cn",
    get label() { return uiText("minimax_china_10b93448") },
    provider_type: "openai",
    base_url: "https://api.minimaxi.com/v1",
    suggested_models: ["MiniMax-M3"],
  },
  // https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope
  // Alibaba is migrating to per-workspace domains ({WorkspaceId}.cn-beijing.maas.
  // aliyuncs.com); the legacy public domain is documented as "仍可正常使用".
  {
    id: "qwen",
    get label() { return uiText("qwen_dashscope_8aaf2acd") },
    provider_type: "openai",
    base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    suggested_models: ["qwen-plus"],
    get note() { return uiText("alibaba_cloud_recommends_migrating_to_a_business_space__9739bc3e") },
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
