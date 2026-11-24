import { beforeEach, describe, expect, it } from "vitest"
import { themeStore } from "./themeState"
import { THEME_STORAGE_KEY, USER_MESSAGE_COLOR_STORAGE_KEY, GLOBAL_ACCENT_COLOR_STORAGE_KEY } from "../theme/storageKeys"

describe("themeStore and global accent color independence", () => {
  beforeEach(() => {
    localStorage.clear()
    themeStore.setState({
      themeMode: "light",
      themePreference: "light",
      userMessageColorPreset: "jade",
      customUserMessageColor: "#345448",
      globalAccentPreset: "teal",
      customGlobalAccentColor: "#396957",
    })
  })

  it("updates and persists global accent preset without altering chat bubble settings", () => {
    // Initial state
    expect(themeStore.getState().globalAccentPreset).toBe("teal")
    expect(themeStore.getState().userMessageColorPreset).toBe("jade")

    // Update global accent preset
    themeStore.getState().setGlobalAccentPreset("blue")

    expect(themeStore.getState().globalAccentPreset).toBe("blue")
    // Chat bubble color settings MUST remain untouched
    expect(themeStore.getState().userMessageColorPreset).toBe("jade")
    expect(themeStore.getState().customUserMessageColor).toBe("#345448")

    // Verify localStorage
    const storedAccent = JSON.parse(localStorage.getItem(GLOBAL_ACCENT_COLOR_STORAGE_KEY) ?? "{}")
    expect(storedAccent).toEqual({ preset: "blue", custom: "#396957" })

    // Verify chat bubble storage was NOT modified or overwritten
    expect(localStorage.getItem(USER_MESSAGE_COLOR_STORAGE_KEY)).toBeNull()
  })

  it("updates and persists custom global accent color without altering chat bubble settings", () => {
    themeStore.getState().setCustomGlobalAccentColor("#2563eb")

    expect(themeStore.getState().globalAccentPreset).toBe("custom")
    expect(themeStore.getState().customGlobalAccentColor).toBe("#2563eb")

    // Chat bubble color settings remain independent
    expect(themeStore.getState().userMessageColorPreset).toBe("jade")
    expect(themeStore.getState().customUserMessageColor).toBe("#345448")

    const storedAccent = JSON.parse(localStorage.getItem(GLOBAL_ACCENT_COLOR_STORAGE_KEY) ?? "{}")
    expect(storedAccent).toEqual({ preset: "custom", custom: "#2563eb" })
    expect(localStorage.getItem(USER_MESSAGE_COLOR_STORAGE_KEY)).toBeNull()
  })

  it("updating chat bubble color does NOT alter global accent settings", () => {
    // Set a distinct global accent first
    themeStore.getState().setGlobalAccentPreset("purple")
    expect(themeStore.getState().globalAccentPreset).toBe("purple")

    // Now change chat bubble color
    themeStore.getState().setUserMessageColorPreset("blue")

    // Chat bubble changed
    expect(themeStore.getState().userMessageColorPreset).toBe("blue")

    // Global accent remains purple and completely unaffected
    expect(themeStore.getState().globalAccentPreset).toBe("purple")
    expect(themeStore.getState().customGlobalAccentColor).toBe("#396957")

    // Custom chat bubble color change
    themeStore.getState().setCustomUserMessageColor("#ff0000")
    expect(themeStore.getState().userMessageColorPreset).toBe("custom")
    expect(themeStore.getState().customUserMessageColor).toBe("#ff0000")

    // Global accent STILL remains purple
    expect(themeStore.getState().globalAccentPreset).toBe("purple")

    // Verify localStorage keys stay strictly isolated
    const storedBubble = JSON.parse(localStorage.getItem(USER_MESSAGE_COLOR_STORAGE_KEY) ?? "{}")
    expect(storedBubble).toEqual({ preset: "custom", custom: "#ff0000" })

    const storedAccent = JSON.parse(localStorage.getItem(GLOBAL_ACCENT_COLOR_STORAGE_KEY) ?? "{}")
    expect(storedAccent).toEqual({ preset: "purple", custom: "#396957" })
  })

  it("preserves light and dark mode toggling alongside global accent color", () => {
    themeStore.getState().setGlobalAccentPreset("rose")
    expect(themeStore.getState().themeMode).toBe("light")

    themeStore.getState().setThemePreference("dark")
    expect(themeStore.getState().themeMode).toBe("dark")
    expect(themeStore.getState().themePreference).toBe("dark")
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark")
    expect(themeStore.getState().globalAccentPreset).toBe("rose")

    themeStore.getState().toggleTheme()
    expect(themeStore.getState().themeMode).toBe("light")
    expect(themeStore.getState().globalAccentPreset).toBe("rose")
  })
})
