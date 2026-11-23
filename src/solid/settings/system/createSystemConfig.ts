import { createSignal, onCleanup, onSettled } from "solid-js"
import { apiClient, getErrorMessage } from "@services/api"
import { serviceFactory, type BambooConfig } from "@services/common/ServiceFactory"
import { createUiText } from "../../shell/uiText"

export type { ContextManagementStrategy, SystemBambooConfig, WorkExecutionSettings, WorkFeatureFlags } from "@/components/chat/settings/system/useSystemConfig"
import type { SystemBambooConfig } from "@/components/chat/settings/system/useSystemConfig"

export type SaveSystemSection = (patch: BambooConfig & Pick<SystemBambooConfig, "memory" | "model_limits">) => Promise<SystemBambooConfig>

export function createSystemConfig(owner: () => boolean) {
  const text = createUiText()
  const [config, setConfig] = createSignal<SystemBambooConfig | null>(null)
  const [loading, setLoading] = createSignal(false)
  const [loadError, setLoadError] = createSignal<string | null>(null)
  let active = true
  let request: AbortController | undefined
  let writeTail: Promise<unknown> = Promise.resolve()

  onCleanup(() => { active = false; request?.abort() })

  const reload = async () => {
    if (!active || !owner()) return
    request?.abort()
    const read = new AbortController()
    request = read
    setLoading(true)
    setLoadError(null)
    try {
      const snapshot = await apiClient.get<SystemBambooConfig>("bamboo/config", { signal: read.signal })
      if (!read.signal.aborted) setConfig(snapshot)
    } catch (error) {
      if (!read.signal.aborted) {
        setConfig(null)
        setLoadError(getErrorMessage(error))
      }
    } finally {
      if (!read.signal.aborted) setLoading(false)
    }
  }
  onSettled(() => { void reload() })

  const saveSection: SaveSystemSection = (patch) => {
    const save = writeTail.then(async () => {
      if (!active || !owner() || !config() || loading()) throw new Error(text("configuration_validation_failed_ed3442af"))
      // The legacy config route replaces model limits even for writes to other sections.
      const latest = await apiClient.get<SystemBambooConfig>("bamboo/config")
      const withLimits = { ...patch, model_limits: patch.model_limits ?? latest.model_limits ?? [] }
      const validation = await serviceFactory.validateBambooConfigPatch(withLimits)
      if (!validation.valid) {
        const issue = Object.values(validation.errors ?? {}).flat().find(Boolean)
        throw new Error(issue?.message || text("configuration_validation_failed_ed3442af"))
      }
      if (!active || !owner()) throw new Error(text("configuration_validation_failed_ed3442af"))
      const saved: SystemBambooConfig = await serviceFactory.setBambooConfig(withLimits)
      if (active) setConfig(saved)
      return saved
    })
    writeTail = save.catch(() => {})
    return save
  }

  return { config, loading, loadError, reload, saveSection }
}
