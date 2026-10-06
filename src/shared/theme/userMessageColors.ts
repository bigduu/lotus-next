export const USER_MESSAGE_COLOR_PRESETS = [
  { id: "jade", light: "#e4eee9", dark: "#263e34" },
  { id: "slate", light: "#e9edef", dark: "#2d343b" },
  { id: "blue", light: "#e4edf4", dark: "#293b4a" },
  { id: "violet", light: "#eeebf5", dark: "#3b334a" },
] as const

export type UserMessageColorPreset = (typeof USER_MESSAGE_COLOR_PRESETS)[number]["id"] | "custom"
export const DEFAULT_CUSTOM_USER_MESSAGE_COLOR = "#345448"

export function isUserMessageColorPreset(value: unknown): value is UserMessageColorPreset {
  return value === "custom" || USER_MESSAGE_COLOR_PRESETS.some((preset) => preset.id === value)
}

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
}

/** sRGB relative luminance, used to keep arbitrary custom colors readable. */
export function colorLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

export function getUserMessageColors(
  mode: "light" | "dark",
  selection: UserMessageColorPreset,
  customColor: string,
): { background: string; foreground: string } {
  if (selection === "custom" && isHexColor(customColor)) {
    const luminance = colorLuminance(customColor)
    return {
      background: customColor.toLowerCase(),
      foreground: (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? "#000000" : "#ffffff",
    }
  }
  const preset = USER_MESSAGE_COLOR_PRESETS.find((item) => item.id === selection) ?? USER_MESSAGE_COLOR_PRESETS[0]
  return { background: preset[mode], foreground: mode === "dark" ? "#e8eeea" : "#24312c" }
}
