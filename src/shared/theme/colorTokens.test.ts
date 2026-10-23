import { describe, expect, it } from "vitest"
import { THEME_COLORS } from "./colorTokens"
import { colorLuminance, getUserMessageColors } from "./userMessageColors"
import { DEFAULT_CUSTOM_GLOBAL_ACCENT_COLOR, getGlobalAccentColors } from "./globalAccentColors"

const contrast = (first: string, second: string) => {
  const [light, dark] = [colorLuminance(first), colorLuminance(second)].sort((a, b) => b - a)
  return (light + 0.05) / (dark + 0.05)
}

describe.each(["light", "dark"] as const)("%s semantic color contract", (mode) => {
  const colors = THEME_COLORS[mode]
  const surfaces = [colors.background, colors.card, colors.popover, colors.sidebar, colors["focus-surface"]]

  it("keeps normal and muted text readable on chat surfaces", () => {
    for (const surface of surfaces) {
      for (const text of [colors.foreground, colors["muted-foreground"]]) {
        expect(contrast(text, surface), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it("keeps every activity-gradient stop readable on its transcript canvas", () => {
    // ProcessActivity is a transcript row, outside the card/focused composer.
    for (const text of [colors.foreground, colors["activity-tone"], colors["activity-shine"]]) {
      expect(contrast(text, colors.background), `${text} on transcript`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it("keeps fixed keyboard focus visible even when arbitrary accent colors are selected", () => {
    for (const custom of ["#ffffff", "#000000", "#777777"]) {
      expect(getGlobalAccentColors(mode, "custom", custom).primary).toBe(custom)
      for (const surface of surfaces) {
        expect(contrast(colors["focus-ring"], surface)).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it("matches the CSS fallback to persisted default accent and user-message preferences", () => {
    const accent = getGlobalAccentColors(mode, "teal", DEFAULT_CUSTOM_GLOBAL_ACCENT_COLOR)
    expect(accent).toEqual({
      primary: colors.primary,
      primaryForeground: colors["primary-foreground"],
      accent: colors.accent,
      accentForeground: colors["accent-foreground"],
    })
    expect(getUserMessageColors(mode, "jade", "invalid")).toEqual({
      background: colors["user-message-background"],
      foreground: colors["user-message-foreground"],
    })
  })
})
