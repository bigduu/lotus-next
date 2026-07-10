const VDI_SAFE_MODE_KEY = "lotus_vdi_safe_mode";

/**
 * Window event fired after {@link setVdiSafeModeEnabled} so same-tab listeners
 * (App.tsx attribute sync) re-read the flag immediately — the browser only
 * emits `storage` events to OTHER tabs. Same name as legacy lotus.
 */
export const VDI_SAFE_MODE_CHANGE_EVENT = "lotus-vdi-safe-mode-change";

export const isVdiSafeModeEnabled = (): boolean => {
  try {
    return localStorage.getItem(VDI_SAFE_MODE_KEY) === "true";
  } catch {
    return false;
  }
};

export const setVdiSafeModeEnabled = (enabled: boolean): void => {
  try {
    localStorage.setItem(VDI_SAFE_MODE_KEY, enabled.toString());
  } catch (error) {
    console.error("[vdiSafeMode] Failed to persist setting:", error);
  }
};

export const getVdiSafeModeStorageKey = (): string => VDI_SAFE_MODE_KEY;
