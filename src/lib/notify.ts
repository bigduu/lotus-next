// Browser notifications for backgrounded agent task events (preference-gated +
// deduped server-side; the frontend just decides whether to surface them).

const KEY = "lotus_notify_enabled_v1"

export function isNotifyEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === "1"
  } catch {
    return false
  }
}

export function setNotifyEnabled(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "1" : "0")
  } catch {
    /* ignore */
  }
}

export function notifyPermission(): NotificationPermission | "unsupported" {
  if (typeof Notification === "undefined") return "unsupported"
  return Notification.permission
}

export async function requestNotifyPermission(): Promise<boolean> {
  if (typeof Notification === "undefined") return false
  if (Notification.permission === "granted") return true
  try {
    return (await Notification.requestPermission()) === "granted"
  } catch {
    return false
  }
}

/** Fire a browser notification if enabled + permitted. No-op otherwise. */
export function notify(title: string, body?: string): void {
  if (!isNotifyEnabled()) return
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return
  try {
    new Notification(title, { body, icon: "/vite.svg" })
  } catch {
    /* ignore */
  }
}
