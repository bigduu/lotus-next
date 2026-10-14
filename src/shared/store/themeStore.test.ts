import { beforeEach, describe, expect, it } from "vitest"
import { useThemeStore } from "./themeStore"
import { THEME_STORAGE_KEY, USER_MESSAGE_COLOR_STORAGE_KEY, GLOBAL_ACCENT_COLOR_STORAGE_KEY } from "../theme/storageKeys"

describe("themeStore and global accent color independence", () => {
  beforeEach(() => {
    localStorage.clear()
    useThemeStore.setState({
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
    expect(useThemeStore.getState().globalAccentPreset).toBe("teal")
    expect(useThemeStore.getState().userMessageColorPreset).toBe("jade")

    // Update global accent preset
    useThemeStore.getState().setGlobalAccentPreset("blue")

    expect(useThemeStore.getState().globalAccentPreset).toBe("blue")
    // Chat bubble color settings MUST remain untouched
    expect(useThemeStore.getState().userMessageColorPreset).toBe("jade")
    expect(useThemeStore.getState().customUserMessageColor).toBe("#345448")

    // Verify localStorage
    const storedAccent = JSON.parse(localStorage.getItem(GLOBAL_ACCENT_COLOR_STORAGE_KEY) ?? "{}")
    expect(storedAccent).toEqual({ preset: "blue", custom: "#396957" })

    // Verify chat bubble storage was NOT modified or overwritten
    expect(localStorage.getItem(USER_MESSAGE_COLOR_STORAGE_KEY)).toBeNull()
  })

  it("updates and persists custom global accent color without altering chat bubble settings", () => {
    useThemeStore.getState().setCustomGlobalAccentColor("#2563eb")

    expect(useThemeStore.getState().globalAccentPreset).toBe("custom")
    expect(useThemeStore.getState().customGlobalAccentColor).toBe("#2563eb")

    // Chat bubble color settings remain independent
    expect(useThemeStore.getState().userMessageColorPreset).toBe("jade")
    expect(useThemeStore.getState().customUserMessageColor).toBe("#345448")

    const storedAccent = JSON.parse(localStorage.getItem(GLOBAL_ACCENT_COLOR_STORAGE_KEY) ?? "{}")
    expect(storedAccent).toEqual({ preset: "custom", custom: "#2563eb" })
    expect(localStorage.getItem(USER_MESSAGE_COLOR_STORAGE_KEY)).toBeNull()
  })

  it("updating chat bubble color does NOT alter global accent settings", () => {
    // Set a distinct global accent first
    useThemeStore.getState().setGlobalAccentPreset("purple")
    expect(useThemeStore.getState().globalAccentPreset).toBe("purple")

    // Now change chat bubble color
    useThemeStore.getState().setUserMessageColorPreset("blue")

    // Chat bubble changed
    expect(useThemeStore.getState().userMessageColorPreset).toBe("blue")

    // Global accent remains purple and completely unaffected
    expect(useThemeStore.getState().globalAccentPreset).toBe("purple")
    expect(useThemeStore.getState().customGlobalAccentColor).toBe("#396957")

    // Custom chat bubble color change
    useThemeStore.getState().setCustomUserMessageColor("#ff0000")
    expect(useThemeStore.getState().userMessageColorPreset).toBe("custom")
    expect(useThemeStore.getState().customUserMessageColor).toBe("#ff0000")

    // Global accent STILL remains purple
    expect(useThemeStore.getState().globalAccentPreset).toBe("purple")

    // Verify localStorage keys stay strictly isolated
    const storedBubble = JSON.parse(localStorage.getItem(USER_MESSAGE_COLOR_STORAGE_KEY) ?? "{}")
    expect(storedBubble).toEqual({ preset: "custom", custom: "#ff0000" })

    const storedAccent = JSON.parse(localStorage.getItem(GLOBAL_ACCENT_COLOR_STORAGE_KEY) ?? "{}")
    expect(storedAccent).toEqual({ preset: "purple", custom: "#396957" })
  })

  it("preserves light and dark mode toggling alongside global accent color", () => {
    useThemeStore.getState().setGlobalAccentPreset("rose")
    expect(useThemeStore.getState().themeMode).toBe("light")

    useThemeStore.getState().setThemePreference("dark")
    expect(useThemeStore.getState().themeMode).toBe("dark")
    expect(useThemeStore.getState().themePreference).toBe("dark")
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark")
    expect(useThemeStore.getState().globalAccentPreset).toBe("rose")

    useThemeStore.getState().toggleTheme()
    expect(useThemeStore.getState().themeMode).toBe("light")
    expect(useThemeStore.getState().globalAccentPreset).toBe("rose")
  })
})
