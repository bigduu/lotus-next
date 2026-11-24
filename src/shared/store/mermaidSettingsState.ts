import { createStore } from "zustand/vanilla";
import { persist } from "zustand/middleware";

/**
 * Mermaid built-in themes
 * @see https://mermaid.js.org/config/theming.html
 */
export type MermaidTheme = "default" | "neutral" | "dark" | "forest" | "base";

/**
 * Mermaid Configuration Settings
 *
 * User-configurable settings for Mermaid diagram rendering
 */
export interface MermaidSettings {
  // Theme
  theme: MermaidTheme;
  themeVariables: Record<string, string>; // Custom theme overrides

  // Global settings
  fontSize: number;
  defaultScale: number;
  useMaxWidth: boolean;

  // Flowchart settings
  flowchartNodeSpacing: number;
  flowchartRankSpacing: number;
  flowchartCurve: "basis" | "linear" | "cardinal";

  // Sequence settings
  sequenceActorMargin: number;
  sequenceMessageMargin: number;
  sequenceWidth: number;
  sequenceHeight: number;

  // Gantt settings
  ganttBarHeight: number;
  ganttTopPadding: number;
}

const DEFAULT_SETTINGS: MermaidSettings = {
  // Theme
  theme: "default",
  themeVariables: {},

  // Global
  fontSize: 16,
  defaultScale: 1.0,
  useMaxWidth: true,

  // Flowchart
  flowchartNodeSpacing: 50,
  flowchartRankSpacing: 50,
  flowchartCurve: "basis",

  // Sequence
  sequenceActorMargin: 50,
  sequenceMessageMargin: 35,
  sequenceWidth: 150,
  sequenceHeight: 65,

  // Gantt
  ganttBarHeight: 20,
  ganttTopPadding: 50,
};

interface MermaidSettingsStore {
  settings: MermaidSettings;
  updateSettings: (updates: Partial<MermaidSettings>) => void;
  resetSettings: () => void;
}

export const mermaidSettingsStore = createStore<MermaidSettingsStore>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,
      updateSettings: (updates) =>
        set((state) => ({
          settings: { ...state.settings, ...updates },
        })),
      resetSettings: () => set({ settings: DEFAULT_SETTINGS }),
    }),
    {
      name: "mermaid-settings",
    },
  ),
);
