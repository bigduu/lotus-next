import { describe, expect, it, vi } from "vitest"
import { useAppStore } from "./appStore"
import { appStore } from "./appStore/state"
import { useProviderStore } from "./appStore/slices/providerSlice"
import { providerStore } from "./appStore/slices/providerState"
import { useMermaidSettingsStore } from "./mermaidSettingsStore"
import { mermaidSettingsStore } from "./mermaidSettingsState"

describe("shared vanilla store bindings", () => {
  it("exposes the same app and provider states through their React bindings", () => {
    expect(useAppStore.getState).toBe(appStore.getState)
    expect(useProviderStore.getState).toBe(providerStore.getState)
  })

  it("keeps the app store selector middleware on both entry points", () => {
    const initial = appStore.getState().agentAvailability
    const next = initial === true ? false : true
    const change = vi.fn()
    const unsubscribe = useAppStore.subscribe((state) => state.agentAvailability, change)
    try {
      appStore.setState({ agentAvailability: next })
      appStore.setState({ agentAvailability: next })
      expect(change).toHaveBeenCalledExactlyOnceWith(next, initial)
    } finally {
      unsubscribe()
      appStore.setState({ agentAvailability: initial })
    }
  })

  it("writes through the existing Mermaid persistence key from either entry point", () => {
    const key = "mermaid-settings"
    const prior = localStorage.getItem(key)
    const settings = mermaidSettingsStore.getState().settings
    const fontSize = settings.fontSize + 1
    try {
      mermaidSettingsStore.getState().updateSettings({ fontSize })
      expect(useMermaidSettingsStore.getState().settings.fontSize).toBe(fontSize)
      expect(JSON.parse(localStorage.getItem(key) ?? "null")?.state.settings.fontSize).toBe(fontSize)
    } finally {
      mermaidSettingsStore.setState({ settings })
      if (prior === null) localStorage.removeItem(key)
      else localStorage.setItem(key, prior)
    }
  })
})
