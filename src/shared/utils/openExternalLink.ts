import { isTauriEnvironment } from "../../utils/environment";

type TauriInternals = {
  invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
};

const getTauriInvoke = (): TauriInternals["invoke"] => {
  const tauriInternals = (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ as
    | TauriInternals
    | undefined;
  return tauriInternals?.invoke;
};

const openInBrowser = (url: string, options?: { allowLocationFallback?: boolean }): void => {
  if (typeof window === "undefined") {
    return;
  }

  const popup = window.open(url, "_blank", "noopener,noreferrer");
  if (popup) {
    popup.opener = null;
    return;
  }

  if (options?.allowLocationFallback ?? true) {
    // Browser fallback for environments that block popups.
    window.location.assign(url);
  }
};

export const openExternalLink = async (url: string): Promise<void> => {
  const normalizedUrl = url.trim();
  if (!normalizedUrl) {
    return;
  }

  const isDesktop = isTauriEnvironment();
  if (isDesktop) {
    const invoke = getTauriInvoke();
    if (typeof invoke === "function") {
      try {
        await invoke("plugin:shell|open", { path: normalizedUrl });
        return;
      } catch (error) {
        console.warn(
          "[openExternalLink] Failed to open via Tauri shell plugin, falling back to browser open.",
          error,
        );
      }
    }

    // In desktop mode, never navigate the current webview as fallback.
    openInBrowser(normalizedUrl, { allowLocationFallback: false });
    return;
  }

  openInBrowser(normalizedUrl);
};

/** Open a local directory in the OS file manager without navigating the webview. */
export const openLocalFolder = async (path: string): Promise<void> => {
  const normalizedPath = path.trim();
  if (!normalizedPath) throw new Error("项目尚未配置主目录");
  if (!isTauriEnvironment()) throw new Error("请在 Bodhi 桌面应用中打开本地目录");

  const invoke = getTauriInvoke();
  if (typeof invoke !== "function") throw new Error("桌面文件管理器暂不可用");
  await invoke("plugin:shell|open", { path: normalizedPath });
};
