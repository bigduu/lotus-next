import { useCallback, useEffect, useRef, useState } from "react"
import { apiClient, getErrorMessage } from "@services/api"
import {
  serviceFactory,
  type BambooConfig,
  type BambooMemoryConfig,
} from "@services/common/ServiceFactory"

/** One persisted model-limit override row (mirrors backend `ModelLimit`). */
export interface ModelLimitOverride {
  model_pattern: string
  max_context_tokens: number
  max_output_tokens?: number | null
  safety_margin?: number | null
}

/**
 * BambooConfig with the extra sections this panel edits typed out
 * (the base interface only carries an index signature for them).
 */
export interface SystemBambooConfig extends BambooConfig {
  memory?: BambooMemoryConfig & { auto_dream_interval_secs?: number }
  hooks?: { image_fallback?: { enabled?: boolean; mode?: string } }
  model_limits?: ModelLimitOverride[]
  access_control?: { password_enabled?: boolean }
}

export interface SystemConfigApi {
  config: SystemBambooConfig | null
  loading: boolean
  loadError: string | null
  reload: () => Promise<void>
  /**
   * Validate then persist a partial config patch. Throws an `Error` with a
   * user-displayable message on validation/save failure.
   */
  saveSection: (patch: SystemBambooConfig) => Promise<SystemBambooConfig>
}

/**
 * Shared loader/saver for the bamboo config sections of the System panel.
 *
 * BACKEND GOTCHA (bamboo `set.rs`): every `POST /v1/bamboo/config` rewrites
 * `model_limits.json` from the patch — a patch WITHOUT a `model_limits` key
 * DELETES the file (all user model limits are lost). Until that is fixed we
 * defensively carry the last-known overrides on every section save.
 */
export function useSystemConfig(): SystemConfigApi {
  const [config, setConfig] = useState<SystemBambooConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Last-known persisted model limits; `null` until the first successful load.
  const modelLimitsRef = useRef<ModelLimitOverride[] | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      // Direct apiClient call: serviceFactory.getBambooConfig() swallows
      // failures into `{}`, which we must surface here instead.
      const cfg = await apiClient.get<SystemBambooConfig>("bamboo/config")
      modelLimitsRef.current = Array.isArray(cfg.model_limits) ? cfg.model_limits : []
      setConfig(cfg)
    } catch (e) {
      setLoadError(getErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const saveSection = useCallback(async (patch: SystemBambooConfig) => {
    const withLimits: SystemBambooConfig = { ...patch }
    if (withLimits.model_limits === undefined && modelLimitsRef.current !== null) {
      withLimits.model_limits = modelLimitsRef.current
    }

    const validation = await serviceFactory.validateBambooConfigPatch(withLimits)
    if (!validation.valid) {
      const issue = Object.values(validation.errors ?? {})
        .flat()
        .filter(Boolean)[0]
      throw new Error(issue?.message || "配置校验未通过")
    }

    const saved = (await serviceFactory.setBambooConfig(withLimits)) as SystemBambooConfig
    modelLimitsRef.current = Array.isArray(saved.model_limits) ? saved.model_limits : []
    setConfig(saved)
    return saved
  }, [])

  return { config, loading, loadError, reload, saveSection }
}

/** Inline status line state shared by the section forms. */
export type SectionMessage = { kind: "ok" | "error"; text: string } | null
