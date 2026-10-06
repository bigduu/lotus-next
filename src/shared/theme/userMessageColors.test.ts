import { describe, expect, it } from "vitest"
import { USER_MESSAGE_COLOR_PRESETS, colorLuminance, getUserMessageColors, isHexColor, isUserMessageColorPreset } from "./userMessageColors"

function contrast(first: string, second: string) {
  const [light, dark] = [colorLuminance(first), colorLuminance(second)].sort((a, b) => b - a)
  return (light + 0.05) / (dark + 0.05)
}

describe("readable user message colors", () => {
  it("keeps every built-in palette readable in both themes", () => {
    for (const preset of USER_MESSAGE_COLOR_PRESETS) {
      for (const mode of ["light", "dark"] as const) {
        const colors = getUserMessageColors(mode, preset.id, "#345448")
        expect(contrast(colors.background, colors.foreground)).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
  it("chooses readable text across the luminance range of arbitrary custom colors", () => {
    for (const color of ["#000000", "#ffffff", "#777777", "#ff0000", "#00ff00", "#0000ff", "#35b9a1"]) {
      const colors = getUserMessageColors("dark", "custom", color)
      expect(colors.background).toBe(color)
      expect(contrast(colors.background, colors.foreground)).toBeGreaterThanOrEqual(4.5)
    }
  })
  it("rejects unsupported presets and CSS values and falls back for invalid custom colors", () => {
    expect(isUserMessageColorPreset("jade")).toBe(true)
    expect(isUserMessageColorPreset("invalid")).toBe(false)
    expect(isHexColor("#abcdef")).toBe(true)
    expect(isHexColor("url(example)" )).toBe(false)
    expect(isHexColor("#abc")).toBe(false)
    expect(getUserMessageColors("dark", "custom", "invalid")).toEqual(getUserMessageColors("dark", "jade", "#345448"))
  })
})
