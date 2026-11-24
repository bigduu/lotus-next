import { bindReactStore } from "./bindReactStore"
import { mermaidSettingsStore } from "./mermaidSettingsState"

export * from "./mermaidSettingsState"
export const useMermaidSettingsStore = bindReactStore(mermaidSettingsStore)

/**
 * Hook to get Mermaid settings with defaults
 */
export const useMermaidSettings = () => {
  const settings = useMermaidSettingsStore((state) => state.settings);
  return settings;
};

/**
 * Hook to update Mermaid settings
 */
export const useUpdateMermaidSettings = () => {
  return useMermaidSettingsStore((state) => state.updateSettings);
};

/**
 * Hook to reset Mermaid settings
 */
export const useResetMermaidSettings = () => {
  return useMermaidSettingsStore((state) => state.resetSettings);
};
