import { createRoot, flush } from "solid-js"
import { describe, expect, it, vi } from "vitest"
import { appStore } from "@shared/store/appStore/state"
import { providerStore } from "@shared/store/appStore/slices/providerState"
import { mermaidSettingsStore } from "@shared/store/mermaidSettingsState"
import { createStoreSelector } from "./createStoreSelector"

describe("shared vanilla store bindings", () => {
  it("reads and tracks the shared app and provider instances from a Solid owner", () => {
    const initial = appStore.getState().agentAvailability
    const next = initial !== true
    const selectors = createRoot((dispose) => ({
      app: createStoreSelector(appStore, (state) => state),
      provider: createStoreSelector(providerStore, (state) => state),
      dispose,
    }))
    try {
      flush()
      expect(selectors.app()).toBe(appStore.getState())
      expect(selectors.provider()).toBe(providerStore.getState())
      appStore.setState({ agentAvailability: next })
      flush()
      expect(selectors.app().agentAvailability).toBe(next)
      expect(selectors.provider()).toBe(providerStore.getState())
    } finally {
      selectors.dispose()
      appStore.setState({ agentAvailability: initial })
    }
  })

  it("keeps the app store selector middleware on the vanilla instance", () => {
    const initial = appStore.getState().agentAvailability
    const next = initial === true ? false : true
    const change = vi.fn()
    const unsubscribe = appStore.subscribe((state) => state.agentAvailability, change)
    try {
      appStore.setState({ agentAvailability: next })
      appStore.setState({ agentAvailability: next })
      expect(change).toHaveBeenCalledExactlyOnceWith(next, initial)
    } finally {
      unsubscribe()
      appStore.setState({ agentAvailability: initial })
    }
  })

  it("writes through the existing Mermaid persistence key", () => {
    const key = "mermaid-settings"
    const prior = localStorage.getItem(key)
    const settings = mermaidSettingsStore.getState().settings
    const fontSize = settings.fontSize + 1
    try {
      mermaidSettingsStore.getState().updateSettings({ fontSize })
      expect(mermaidSettingsStore.getState().settings.fontSize).toBe(fontSize)
      expect(JSON.parse(localStorage.getItem(key) ?? "null")?.state.settings.fontSize).toBe(fontSize)
    } finally {
      mermaidSettingsStore.setState({ settings })
      if (prior === null) localStorage.removeItem(key)
      else localStorage.setItem(key, prior)
    }
  })
})
