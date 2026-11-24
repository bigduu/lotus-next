import { render } from "@solidjs/web"
import { flush } from "solid-js"
import { afterEach, describe, expect, it, vi } from "vitest"
import { uiText } from "@shared/i18n/text"
import { metricsService } from "@services/metrics"
import { experienceModeStore } from "@shared/store/experienceModeState"
import { themeStore } from "@shared/store/themeState"
import { SettingsPage } from "./SettingsPage"

vi.mock("@lucide/solid", () => {
  const Icon = () => null
  return Object.fromEntries([
    "Bell", "Blocks", "BookOpen", "CalendarClock", "ChartNoAxesCombined", "Cpu", "Database", "FileText",
    "Gauge", "Globe", "Monitor", "Moon", "Network", "Plug", "RotateCw", "Settings2", "Share2", "ShieldCheck", "Sun",
  ].map((name) => [name, Icon]))
})
// These cases run the real theme state, navigation and native color controls.
vi.mock("../ui/switch", () => ({ Switch: () => null }))

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})
async function settle(action: () => unknown) {
  await action()
  await Promise.resolve()
  flush()
}
async function mount(view: () => ReturnType<typeof SettingsPage>) {
  const container = document.body.appendChild(document.createElement("div"))
  const dispose = render(view, container)
  cleanups.push(() => { dispose(); container.remove() })
  await settle(() => {})
  return { container }
}
const click = (element: Element | null) => settle(() => {
  expect(element).toBeInstanceOf(HTMLElement)
  ;(element as HTMLElement).click()
})

describe("Settings page controls", () => {
  it("keeps category navigation usable in both layouts and exposes the selected bubble color", async () => {
    const previousTheme = themeStore.getState()
    const previousExperience = experienceModeStore.getState()
    vi.spyOn(metricsService, "getSummary").mockRejectedValue(new Error("offline"))
    themeStore.setState({ themeMode: "light", themePreference: "light", userMessageColorPreset: "jade" })
    experienceModeStore.setState({ mode: "advanced", isAdvanced: true })
    const onTabChange = vi.fn()

    try {
      const view = await mount(() => <SettingsPage tab="general" ownerAccess onTabChange={onTabChange} />)
      const nav = view.container.querySelector("nav")
      expect([...nav?.querySelectorAll("h3") ?? []].map((heading) => heading.textContent)).toEqual([
        uiText("settings_group_appearance"),
        uiText("settings_group_connections"),
        uiText("settings_group_capabilities"),
        uiText("settings_group_safety"),
      ])
      expect(nav?.querySelector('[aria-current="page"]')?.textContent).toBe(uiText("general_835b700e"))

      await click([...nav?.querySelectorAll("button") ?? []].find((button) => button.textContent === "MCP") ?? null)
      expect(onTabChange).toHaveBeenLastCalledWith("mcp")

      const category = view.container.querySelector<HTMLSelectElement>("#settings-category")
      expect(category?.querySelectorAll("optgroup")).toHaveLength(4)
      expect(category?.options).toHaveLength(18)
      expect(category?.querySelector('option[value="workflows"]')).toBeNull()
      expect(category?.querySelector('option[value="config-share"]')?.textContent).toBe(uiText("share_title"))
      expect(category?.querySelector('option[value="retry"]')?.textContent).toBe(uiText("retry_settings_1a7c4e91"))
      await click([...nav?.querySelectorAll("button") ?? []].find((button) => button.textContent === uiText("share_title")) ?? null)
      expect(onTabChange).toHaveBeenLastCalledWith("config-share")
      await settle(async () => {
        if (category) category.value = "config-share"
        category?.dispatchEvent(new Event("change", { bubbles: true }))
      })
      expect(onTabChange).toHaveBeenLastCalledWith("config-share")
      await settle(async () => {
        if (category) category.value = "notifications"
        category?.dispatchEvent(new Event("change", { bubbles: true }))
      })
      expect(onTabChange).toHaveBeenLastCalledWith("notifications")

      const blue = [...view.container.querySelectorAll("button")].find((button) => button.textContent === uiText("bubble_blue"))
      expect(blue?.getAttribute("aria-pressed")).toBe("false")
      await click(blue ?? null)
      expect(blue?.getAttribute("aria-pressed")).toBe("true")
      expect(themeStore.getState().userMessageColorPreset).toBe("blue")
      expect(view.container.querySelector('input[type="color"]')).not.toBeNull()

      await settle(async () => {
        experienceModeStore.setState({ mode: "simple", isAdvanced: false })
      })
      expect([...category?.options ?? []].map((option) => option.value)).not.toContain("jiandu")
      expect([...category?.options ?? []].map((option) => option.value)).toContain("providers")
    } finally {
      await settle(async () => {
        themeStore.setState(previousTheme)
        experienceModeStore.setState(previousExperience)
      })
    }
  })

  it("updates global accent preview, store, and document CSS variables on preset selection and custom color input without affecting message bubbles", async () => {
    const previousTheme = themeStore.getState()
    const previousExperience = experienceModeStore.getState()
    vi.spyOn(metricsService, "getSummary").mockRejectedValue(new Error("offline"))
    themeStore.setState({
      themeMode: "light",
      themePreference: "light",
      userMessageColorPreset: "jade",
      customUserMessageColor: "#345448",
      globalAccentPreset: "teal",
      customGlobalAccentColor: "#396957",
    })
    experienceModeStore.setState({ mode: "advanced", isAdvanced: true })
    const onTabChange = vi.fn()

    try {
      const view = await mount(() => <SettingsPage tab="general" ownerAccess onTabChange={onTabChange} />)

      // Verify preset choices are visible
      const blueAccent = [...view.container.querySelectorAll(".settings-accent-option")].find(
        (button) => button.textContent === uiText("accent_blue"),
      )
      expect(blueAccent).toBeDefined()
      expect(blueAccent?.getAttribute("aria-pressed")).toBe("false")

      // Click blue preset
      await click(blueAccent ?? null)
      expect(blueAccent?.getAttribute("aria-pressed")).toBe("true")
      expect(themeStore.getState().globalAccentPreset).toBe("blue")
      expect(document.documentElement.style.getPropertyValue("--primary")).toBe("#2563eb")

      // Verify chat bubble preset was NOT changed
      expect(themeStore.getState().userMessageColorPreset).toBe("jade")

      // Test custom accent color picker
      const customAccentBtn = [...view.container.querySelectorAll(".settings-accent-option")].find(
        (button) => button.textContent === uiText("accent_custom"),
      )
      expect(customAccentBtn).toBeDefined()
      await click(customAccentBtn ?? null)
      expect(themeStore.getState().globalAccentPreset).toBe("custom")

      const accentInput = view.container.querySelector<HTMLInputElement>(".settings-accent-custom input[type='color']")
      expect(accentInput).not.toBeNull()

      const setInputValue = (input: HTMLInputElement, value: string) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
      }

      // Simulate real-time color drag/input event
      await settle(async () => {
        if (accentInput) {
          setInputValue(accentInput, "#7c3aed")
          accentInput.dispatchEvent(new Event("input", { bubbles: true }))
        }
        await Promise.resolve()
      })

      expect(themeStore.getState().customGlobalAccentColor).toBe("#7c3aed")
      expect(document.documentElement.style.getPropertyValue("--primary")).toBe("#7c3aed")

      // Hex label and preview reflect the selected custom accent
      const accentLabel = view.container.querySelector(".settings-accent-custom span")
      expect(accentLabel?.textContent).toBe("#7C3AED")

      // Verify chat bubble settings remain completely independent
      expect(themeStore.getState().userMessageColorPreset).toBe("jade")
      expect(themeStore.getState().customUserMessageColor).toBe("#345448")
    } finally {
      await settle(async () => {
        themeStore.setState(previousTheme)
        experienceModeStore.setState(previousExperience)
      })
    }
  })

  it("updates custom message bubble preview, label, and store on color input and change events", async () => {
    const previousTheme = themeStore.getState()
    const previousExperience = experienceModeStore.getState()
    vi.spyOn(metricsService, "getSummary").mockRejectedValue(new Error("offline"))
    themeStore.setState({
      themeMode: "light",
      themePreference: "light",
      userMessageColorPreset: "jade",
      customUserMessageColor: "#345448",
    })
    experienceModeStore.setState({ mode: "advanced", isAdvanced: true })
    const onTabChange = vi.fn()

    try {
      const view = await mount(() => <SettingsPage tab="general" ownerAccess onTabChange={onTabChange} />)

      const customOption = [...view.container.querySelectorAll(".settings-bubble-option")].find(
        (button) => button.textContent === uiText("bubble_custom"),
      )
      expect(customOption?.getAttribute("aria-pressed")).toBe("false")
      await click(customOption ?? null)
      expect(customOption?.getAttribute("aria-pressed")).toBe("true")
      expect(themeStore.getState().userMessageColorPreset).toBe("custom")

      const colorInput = view.container.querySelector<HTMLInputElement>('.settings-bubble-custom input[type="color"]')
      expect(colorInput).not.toBeNull()
      const colorLabel = view.container.querySelector(".settings-bubble-custom span")
      const previewParagraph = view.container.querySelector<HTMLParagraphElement>(".settings-bubble-preview p")

      expect(colorLabel?.textContent).toBe("#345448")
      expect(previewParagraph?.style.backgroundColor).toBe("rgb(52, 84, 72)")

      const setInputValue = (input: HTMLInputElement, value: string) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
      }

      await settle(async () => {
        if (colorInput) {
          setInputValue(colorInput, "#ff0000")
          colorInput.dispatchEvent(new Event("input", { bubbles: true }))
        }
        await Promise.resolve()
      })

      expect(themeStore.getState().customUserMessageColor).toBe("#ff0000")
      expect(colorLabel?.textContent).toBe("#FF0000")
      expect(previewParagraph?.style.backgroundColor).toBe("rgb(255, 0, 0)")
      expect(previewParagraph?.style.color).toBe("rgb(0, 0, 0)")

      await settle(async () => {
        if (colorInput) {
          setInputValue(colorInput, "#2563eb")
          colorInput.dispatchEvent(new Event("change", { bubbles: true }))
        }
        await Promise.resolve()
      })

      expect(themeStore.getState().customUserMessageColor).toBe("#2563eb")
      expect(colorLabel?.textContent).toBe("#2563EB")
      expect(previewParagraph?.style.backgroundColor).toBe("rgb(37, 99, 235)")
      expect(previewParagraph?.style.color).toBe("rgb(255, 255, 255)")
    } finally {
      await settle(async () => {
        themeStore.setState(previousTheme)
        experienceModeStore.setState(previousExperience)
      })
    }
  })
})
