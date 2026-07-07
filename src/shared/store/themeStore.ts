import { create } from "zustand";
import { THEME_STORAGE_KEY } from "@shared/theme/storageKeys";

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

export const useThemeStore = create<ThemeState>((set, get) => ({
  themePreference: readPersistedPreference(),
  themeMode: resolve(readPersistedPreference()),
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
