import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SettingsContent } from "./Settings"

const roots: Root[] = []
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
environment.IS_REACT_ACT_ENVIRONMENT = true

// The panels pull in heavy services; this test only asserts navigation.
vi.mock("@/components/chat/settings/SettingsProviders", () => ({ SettingsProviders: () => null }))
vi.mock("@/components/chat/settings/SettingsConfigShare", () => ({ SettingsConfigShare: () => null }))
vi.mock("@/components/chat/settings/SettingsModelLimits", () => ({ SettingsModelLimits: () => null }))
vi.mock("@/components/chat/settings/SettingsRetry", () => ({ SettingsRetry: () => null }))
vi.mock("@/components/chat/settings/SettingsMcp", () => ({ SettingsMcp: () => null }))
vi.mock("@/components/chat/settings/SettingsClusters", () => ({ SettingsClusters: () => null }))
vi.mock("@/components/chat/settings/SettingsPlugins", () => ({ SettingsPlugins: () => null }))
vi.mock("@/components/chat/settings/SettingsSkills", () => ({ SettingsSkills: () => null }))
vi.mock("@/components/chat/settings/SettingsPrompts", () => ({ SettingsPrompts: () => null }))
vi.mock("@/components/chat/settings/SettingsWorkflows", () => ({ SettingsWorkflows: () => null }))
vi.mock("@/components/chat/settings/SettingsSchedules", () => ({ SettingsSchedules: () => null }))
vi.mock("@/components/chat/settings/SettingsJiandu", () => ({ SettingsJiandu: () => null }))
vi.mock("@/components/chat/settings/SettingsPermissions", () => ({ SettingsPermissions: () => null }))
vi.mock("@/components/chat/settings/SettingsMasking", () => ({ SettingsMasking: () => null }))
vi.mock("@/components/chat/settings/SettingsEnv", () => ({ SettingsEnv: () => null }))
vi.mock("@/components/chat/settings/SettingsMetrics", () => ({ SettingsMetrics: () => null }))
vi.mock("@/components/chat/settings/SettingsSystem", () => ({ SettingsSystem: () => null }))
vi.mock("@/components/chat/settings/SettingsNotifications", () => ({ SettingsNotifications: () => null }))

async function mount(tab: Parameters<typeof SettingsContent>[0]["tab"]): Promise<HTMLElement> {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  roots.push(root)
  await act(async () => {
    root.render(<SettingsContent tab={tab} onTabChange={() => {}} />)
  })
  return host
}

describe("SettingsContent navigation", () => {
  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount()
    })
    document.body.innerHTML = ""
  })

  /**
   * A tab registered in `TABS` but missing from `TAB_GROUPS` is unreachable: the
   * desktop nav buttons and the mobile selector are both built from the groups.
   */
  it("exposes the network retry panel in both the nav buttons and the mobile selector", async () => {
    const host = await mount("retry")

    const navLabels = [...host.querySelectorAll("nav.settings-nav button")].map((b) => b.textContent ?? "")
    expect(navLabels.some((label) => label.trim().length > 0 && label.includes("网络重试")) ||
      navLabels.some((label) => label.includes("Network retry"))).toBe(true)

    const options = [...host.querySelectorAll("select#settings-category option")].map((o) => o.getAttribute("value"))
    expect(options).toContain("retry")
  })

  it("renders every registered tab in exactly one navigation group", async () => {
    const host = await mount("general")
    const options = [...host.querySelectorAll("select#settings-category option")].map((o) => o.getAttribute("value"))
    // Duplicated group membership would render the same id twice.
    expect(new Set(options).size).toBe(options.length)
    expect(options).toContain("retry")
    expect(options).toContain("model-limits")
    expect(options).toContain("providers")
  })
})
