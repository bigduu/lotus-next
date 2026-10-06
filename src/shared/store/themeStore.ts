import { create } from "zustand";
import { THEME_STORAGE_KEY, USER_MESSAGE_COLOR_STORAGE_KEY } from "@shared/theme/storageKeys";
import { DEFAULT_CUSTOM_USER_MESSAGE_COLOR, isHexColor, isUserMessageColorPreset, type UserMessageColorPreset } from "@shared/theme/userMessageColors";

type ThemeMode = "light" | "dark";
/** What the user picked: an explicit mode, or follow the OS setting. */
type ThemePreference = ThemeMode | "system";

type ThemeState = {
  /** The RESOLVED mode (what the UI renders) — never "system". */
  themeMode: ThemeMode;
  /** The user's choice, persisted; "system" tracks prefers-color-scheme live. */
  themePreference: ThemePreference;
  setThemePreference: (preference: ThemePreference) => void;
  toggleTheme: () => void;
  userMessageColorPreset: UserMessageColorPreset;
  customUserMessageColor: string;
  setUserMessageColorPreset: (preset: UserMessageColorPreset) => void;
  setCustomUserMessageColor: (color: string) => void;
};

const systemQuery = (): MediaQueryList | undefined =>
  typeof window !== "undefined" ? window.matchMedia?.("(prefers-color-scheme: dark)") : undefined;

const systemMode = (): ThemeMode => (systemQuery()?.matches ? "dark" : "light");

const resolve = (preference: ThemePreference): ThemeMode =>
  preference === "system" ? systemMode() : preference;

function readPersistedPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    /* noop */
  }
  return "system";
}

function readUserMessageColor(): { preset: UserMessageColorPreset; custom: string } {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(USER_MESSAGE_COLOR_STORAGE_KEY) ?? "null");
    if (parsed && typeof parsed === "object" && "preset" in parsed && "custom" in parsed
      && isUserMessageColorPreset(parsed.preset) && isHexColor(parsed.custom)) {
      return { preset: parsed.preset, custom: parsed.custom.toLowerCase() };
    }
  } catch { /* Storage may be blocked or contain an older malformed value. */ }
  return { preset: "jade", custom: DEFAULT_CUSTOM_USER_MESSAGE_COLOR };
}

const initialUserMessageColor = readUserMessageColor();
const persistUserMessageColor = (preset: UserMessageColorPreset, custom: string) => {
  try { localStorage.setItem(USER_MESSAGE_COLOR_STORAGE_KEY, JSON.stringify({ preset, custom })); }
  catch { /* The visual preference still works when persistence is blocked. */ }
};

export const useThemeStore = create<ThemeState>((set, get) => ({
  themePreference: readPersistedPreference(),
  themeMode: resolve(readPersistedPreference()),
  userMessageColorPreset: initialUserMessageColor.preset,
  customUserMessageColor: initialUserMessageColor.custom,
  setUserMessageColorPreset: (preset) => {
    if (!isUserMessageColorPreset(preset)) return;
    persistUserMessageColor(preset, get().customUserMessageColor);
    set({ userMessageColorPreset: preset });
  },
  setCustomUserMessageColor: (color) => {
    if (!isHexColor(color)) return;
    const custom = color.toLowerCase();
    persistUserMessageColor("custom", custom);
    set({ userMessageColorPreset: "custom", customUserMessageColor: custom });
  },
  setThemePreference: (preference) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch {
      /* noop */
    }
    set({ themePreference: preference, themeMode: resolve(preference) });
  },
  toggleTheme: () => {
    // Toggling from "system" pins the OPPOSITE of the current resolved mode.
    const next: ThemeMode = get().themeMode === "dark" ? "light" : "dark";
    get().setThemePreference(next);
  },
}));

// Follow OS changes live while the preference is "system".
systemQuery()?.addEventListener?.("change", () => {
  const state = useThemeStore.getState();
  if (state.themePreference === "system") {
    useThemeStore.setState({ themeMode: systemMode() });
  }
});
