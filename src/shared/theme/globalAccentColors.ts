import { colorLuminance, isHexColor } from "./userMessageColors"
import { DEFAULT_ACCENT_COLORS, JADE_ACCENT_COLORS, THEME_COLORS } from "./colorTokens"

export interface AccentColorPair {
  primary: string
  primaryForeground: string
  accent: string
  accentForeground: string
}

export const GLOBAL_ACCENT_PRESETS = [
  {
    id: "neutral",
    ...DEFAULT_ACCENT_COLORS,
  },
  {
    id: "teal",
    ...JADE_ACCENT_COLORS,
  },
  {
    id: "blue",
    light: {
      primary: "#2563eb",
      primaryForeground: "#ffffff",
      accent: "#eff6ff",
      accentForeground: "#1e40af",
    },
    dark: {
      primary: "#60a5fa",
      primaryForeground: "#0a101f",
      accent: "#1e293b",
      accentForeground: "#bfdbfe",
    },
  },
  {
    id: "purple",
    light: {
      primary: "#7c3aed",
      primaryForeground: "#ffffff",
      accent: "#f5f3ff",
      accentForeground: "#5b21b6",
    },
    dark: {
      primary: "#a78bfa",
      primaryForeground: "#110924",
      accent: "#281b3d",
      accentForeground: "#ddd6fe",
    },
  },
  {
    id: "green",
    light: {
      primary: "#15803d",
      primaryForeground: "#ffffff",
      accent: "#f0fdf4",
      accentForeground: "#166534",
    },
    dark: {
      primary: "#4ade80",
      primaryForeground: "#05210e",
      accent: "#14532d",
      accentForeground: "#bbf7d0",
    },
  },
  {
    id: "rose",
    light: {
      primary: "#e11d48",
      primaryForeground: "#ffffff",
      accent: "#fff1f2",
      accentForeground: "#9f1239",
    },
    dark: {
      primary: "#fb7185",
      primaryForeground: "#26040c",
      accent: "#4c0519",
      accentForeground: "#fecdd3",
    },
  },
  {
    id: "orange",
    light: {
      primary: "#c2410c",
      primaryForeground: "#ffffff",
      accent: "#fff7ed",
      accentForeground: "#9a3412",
    },
    dark: {
      primary: "#fb923c",
      primaryForeground: "#291102",
      accent: "#431407",
      accentForeground: "#fed7aa",
    },
  },
] as const

export type GlobalAccentPreset = (typeof GLOBAL_ACCENT_PRESETS)[number]["id"] | "custom"

export const DEFAULT_GLOBAL_ACCENT_PRESET: GlobalAccentPreset = "neutral"
export const DEFAULT_CUSTOM_GLOBAL_ACCENT_COLOR = DEFAULT_ACCENT_COLORS.light.primary

export function isGlobalAccentPreset(value: unknown): value is GlobalAccentPreset {
  return value === "custom" || GLOBAL_ACCENT_PRESETS.some((preset) => preset.id === value)
}

export function getCustomAccentColors(
  mode: "light" | "dark",
  customHex: string,
): AccentColorPair {
  const primary = isHexColor(customHex) ? customHex.toLowerCase() : DEFAULT_CUSTOM_GLOBAL_ACCENT_COLOR
  const luminance = colorLuminance(primary)

  // Use standard WCAG contrast check to select white or dark text on primary
  const contrastWithWhite = 1.05 / (luminance + 0.05)
  const contrastWithBlack = (luminance + 0.05) / 0.05
  const primaryForeground = contrastWithWhite >= contrastWithBlack ? "#ffffff" : "#000000"

  const accent = mode === "dark"
    ? `color-mix(in oklab, ${primary} 22%, ${THEME_COLORS.dark.card})`
    : `color-mix(in oklab, ${primary} 12%, ${THEME_COLORS.light.popover})`

  const accentForeground = THEME_COLORS[mode].foreground

  return { primary, primaryForeground, accent, accentForeground }
}

export function getGlobalAccentColors(
  mode: "light" | "dark",
  preset: GlobalAccentPreset,
  customColor: string,
): AccentColorPair {
  if (preset === "custom") {
    return getCustomAccentColors(mode, customColor)
  }
  const match = GLOBAL_ACCENT_PRESETS.find((p) => p.id === preset) ?? GLOBAL_ACCENT_PRESETS[0]
  return match[mode]
}

export function applyGlobalAccentToDocument(colors: AccentColorPair): void {
  if (typeof document === "undefined") return
  const root = document.documentElement
  root.style.setProperty("--primary", colors.primary)
  root.style.setProperty("--primary-foreground", colors.primaryForeground)
  root.style.setProperty("--accent", colors.accent)
  root.style.setProperty("--accent-foreground", colors.accentForeground)
  root.style.setProperty("--ring", colors.primary)
  root.style.setProperty("--sidebar-primary", colors.primary)
  root.style.setProperty("--sidebar-primary-foreground", colors.primaryForeground)
  root.style.setProperty("--sidebar-accent", colors.accent)
  root.style.setProperty("--sidebar-accent-foreground", colors.accentForeground)
  root.style.setProperty("--sidebar-ring", colors.primary)
  root.style.setProperty("--global-accent", colors.primary)
  root.style.setProperty("--global-accent-foreground", colors.primaryForeground)
}
