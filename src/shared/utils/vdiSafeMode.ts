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

/**
 * Subscribe to VDI safe-mode changes: the same-tab custom event plus cross-tab
 * `storage` events FILTERED to this flag's key — other keys (e.g. the account
 * feed's cursor, written on every change event) must not re-trigger listeners.
 * A `null` storage key (`localStorage.clear()`) also counts: it resets the
 * flag. Returns an unsubscribe function.
 */
export const onVdiSafeModeChange = (listener: () => void): (() => void) => {
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== null && event.key !== VDI_SAFE_MODE_KEY) return;
    listener();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(VDI_SAFE_MODE_CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(VDI_SAFE_MODE_CHANGE_EVENT, listener);
  };
};
