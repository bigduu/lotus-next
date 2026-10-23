/** Sparse, theme-specific steps preserve the established Lotus palette.
 * Components consume semantic variables, never these raw palette steps. */
export const COLOR_PALETTE = {
  light: {
    neutral: {
      0: "#ffffff", 1: "#fafbfb", 2: "#f3f6f4", 3: "#f1f5f3",
      4: "#ecf0ee", 5: "#eaf0ed", 6: "#dde2e0", 7: "#cdd4d1",
      11: "#5a635f", 12: "#1b221f",
    },
    jade: {
      1: "#fafafa", 3: "#e2efe8", 4: "#e4eee9", 9: "#396957",
      11: "#20392f", 12: "#24312c",
    },
    steel: { 11: "#637183", 12: "#3c4652" },
    danger: "oklch(0.577 0.245 27.325)",
  },
  dark: {
    neutral: {
      1: "#101412", 2: "#151a18", 3: "#181d1b", 4: "#1e2320",
      5: "#1e2621", 6: "#242927", 7: "oklch(1 0 0 / 10%)",
      8: "oklch(1 0 0 / 15%)", 11: "#a0a6a3", 12: "#eaeeec",
    },
    jade: {
      1: "#0f1612", 3: "#24312b", 4: "#263e34", 9: "#7db29d",
      11: "#d0e4da", 12: "#e8eeea",
    },
    steel: { 11: "#a4adba", 12: "#e6e9ef" },
    danger: "oklch(0.704 0.191 22.216)",
  },
} as const

const { light, dark } = COLOR_PALETTE

/** The persisted `teal` preset and pre-JS CSS fallback share these values. */
export const DEFAULT_ACCENT_COLORS = {
  light: {
    primary: light.jade[9],
    primaryForeground: light.jade[1],
    accent: light.jade[3],
    accentForeground: light.jade[11],
  },
  dark: {
    primary: dark.jade[9],
    primaryForeground: dark.jade[1],
    accent: dark.jade[3],
    accentForeground: dark.jade[11],
  },
} as const

/** Existing shadcn names are the public semantic contract. Focus deliberately
 * uses the fixed palette rather than the user-overridable --primary/--ring. */
export const THEME_COLORS = {
  light: {
    background: light.neutral[1],
    foreground: light.neutral[12],
    card: light.neutral[2],
    popover: light.neutral[0],
    primary: DEFAULT_ACCENT_COLORS.light.primary,
    "primary-foreground": DEFAULT_ACCENT_COLORS.light.primaryForeground,
    secondary: light.neutral[4],
    "muted-foreground": light.neutral[11],
    accent: DEFAULT_ACCENT_COLORS.light.accent,
    "accent-foreground": DEFAULT_ACCENT_COLORS.light.accentForeground,
    destructive: light.danger,
    border: light.neutral[6],
    input: light.neutral[7],
    "focus-ring": light.jade[9],
    "focus-halo": `${light.jade[9]}2e`,
    "focus-surface": light.neutral[5],
    sidebar: light.neutral[3],
    "user-message-background": light.jade[4],
    "user-message-foreground": light.jade[12],
    "activity-tone": light.steel[12],
    "activity-shine": light.steel[11],
  },
  dark: {
    background: dark.neutral[1],
    foreground: dark.neutral[12],
    card: dark.neutral[3],
    popover: dark.neutral[4],
    primary: DEFAULT_ACCENT_COLORS.dark.primary,
    "primary-foreground": DEFAULT_ACCENT_COLORS.dark.primaryForeground,
    secondary: dark.neutral[6],
    "muted-foreground": dark.neutral[11],
    accent: DEFAULT_ACCENT_COLORS.dark.accent,
    "accent-foreground": DEFAULT_ACCENT_COLORS.dark.accentForeground,
    destructive: dark.danger,
    border: dark.neutral[7],
    input: dark.neutral[8],
    "focus-ring": dark.jade[9],
    "focus-halo": `${dark.jade[9]}2e`,
    "focus-surface": dark.neutral[5],
    sidebar: dark.neutral[2],
    "user-message-background": dark.jade[4],
    "user-message-foreground": dark.jade[12],
    "activity-tone": dark.steel[11],
    "activity-shine": dark.steel[12],
  },
} as const

/** Compatibility aliases stay live when a host/user updates a semantic color. */
export const THEME_COLOR_ALIASES = {
  "card-foreground": "foreground",
  "popover-foreground": "foreground",
  "secondary-foreground": "foreground",
  muted: "secondary",
  ring: "primary",
  "sidebar-foreground": "foreground",
  "sidebar-primary": "primary",
  "sidebar-primary-foreground": "primary-foreground",
  "sidebar-accent": "accent",
  "sidebar-accent-foreground": "accent-foreground",
  "sidebar-border": "border",
  "sidebar-ring": "primary",
} as const satisfies Record<string, keyof typeof THEME_COLORS.light>
