import { describe, expect, it } from "vitest"
import { colorLuminance } from "./userMessageColors"
import {
  GLOBAL_ACCENT_PRESETS,
  DEFAULT_GLOBAL_ACCENT_PRESET,
  DEFAULT_CUSTOM_GLOBAL_ACCENT_COLOR,
  getGlobalAccentColors,
  isGlobalAccentPreset,
  applyGlobalAccentToDocument,
} from "./globalAccentColors"

function contrast(first: string, second: string) {
  const [light, dark] = [colorLuminance(first), colorLuminance(second)].sort((a, b) => b - a)
  return (light + 0.05) / (dark + 0.05)
}

describe("global accent colors", () => {
  it("preserves Lotus Next existing appearance with default teal preset", () => {
    expect(DEFAULT_GLOBAL_ACCENT_PRESET).toBe("teal")
    expect(DEFAULT_CUSTOM_GLOBAL_ACCENT_COLOR).toBe("#396957")

    const lightTeal = getGlobalAccentColors("light", "teal", "#396957")
    expect(lightTeal.primary).toBe("#396957")
    expect(lightTeal.primaryForeground).toBe("#fafafa")
    expect(lightTeal.accent).toBe("#e2efe8")
    expect(lightTeal.accentForeground).toBe("#20392f")

    const darkTeal = getGlobalAccentColors("dark", "teal", "#396957")
    expect(darkTeal.primary).toBe("#7db29d")
    expect(darkTeal.primaryForeground).toBe("#0f1612")
    expect(darkTeal.accent).toBe("#24312b")
    expect(darkTeal.accentForeground).toBe("#d0e4da")
  })

  it("maintains readable contrast (>= 4.5) for every built-in preset in both themes", () => {
    for (const preset of GLOBAL_ACCENT_PRESETS) {
      for (const mode of ["light", "dark"] as const) {
        const colors = getGlobalAccentColors(mode, preset.id, "#396957")
        // Check primary button text contrast
        expect(contrast(colors.primary, colors.primaryForeground)).toBeGreaterThanOrEqual(4.5)
        // Check subtle accent background vs foreground contrast (where direct hex colors are used)
        if (colors.accent.startsWith("#") && colors.accentForeground.startsWith("#")) {
          expect(contrast(colors.accent, colors.accentForeground)).toBeGreaterThanOrEqual(4.5)
        }
      }
    }
  })

  it("chooses readable text across arbitrary custom colors", () => {
    for (const color of ["#000000", "#ffffff", "#777777", "#ff0000", "#00ff00", "#0000ff", "#2563eb", "#ea580c"]) {
      const colors = getGlobalAccentColors("dark", "custom", color)
      expect(colors.primary).toBe(color)
      const ratio = contrast(colors.primary, colors.primaryForeground)
      expect(ratio).toBeGreaterThanOrEqual(3.0)
    }
  })

  it("validates preset keys and falls back gracefully for invalid values", () => {
    expect(isGlobalAccentPreset("teal")).toBe(true)
    expect(isGlobalAccentPreset("blue")).toBe(true)
    expect(isGlobalAccentPreset("purple")).toBe(true)
    expect(isGlobalAccentPreset("green")).toBe(true)
    expect(isGlobalAccentPreset("rose")).toBe(true)
    expect(isGlobalAccentPreset("orange")).toBe(true)
    expect(isGlobalAccentPreset("custom")).toBe(true)
    expect(isGlobalAccentPreset("invalid")).toBe(false)
    expect(isGlobalAccentPreset(null)).toBe(false)

    // Falls back to default teal for unknown preset
    // @ts-expect-error Testing invalid runtime value
    const fallback = getGlobalAccentColors("light", "unknown", "#123456")
    expect(fallback.primary).toBe("#396957")
  })

  it("applies accent CSS custom properties to documentElement", () => {
    const colors = getGlobalAccentColors("light", "blue", "#2563eb")
    applyGlobalAccentToDocument(colors)

    const root = document.documentElement
    expect(root.style.getPropertyValue("--primary")).toBe(colors.primary)
    expect(root.style.getPropertyValue("--primary-foreground")).toBe(colors.primaryForeground)
    expect(root.style.getPropertyValue("--accent")).toBe(colors.accent)
    expect(root.style.getPropertyValue("--accent-foreground")).toBe(colors.accentForeground)
    expect(root.style.getPropertyValue("--ring")).toBe(colors.primary)
    expect(root.style.getPropertyValue("--sidebar-primary")).toBe(colors.primary)
    expect(root.style.getPropertyValue("--sidebar-accent")).toBe(colors.accent)
    expect(root.style.getPropertyValue("--global-accent")).toBe(colors.primary)
  })
})
