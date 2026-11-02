/**
 * Opt-in render accounting for diagnosing re-render storms in a running app.
 *
 * Every instrumented component pays exactly one boolean check per render while
 * the probe is off, so production builds stay unaffected. Dev builds enable it
 * by default; a production build can be inspected without a rebuild through
 * `localStorage.zenith_render_probe = "1"` plus a reload.
 *
 * Usage in a browser console:
 *   __renderProbe.read()        // cumulative counters
 *   __renderProbe.watch(5)      // sample 5s, print a ranked delta table
 *   __renderProbe.reset()
 *   __renderProbe.disable()
 */
import { isDevRuntime } from "@shared/utils/debugFlags"

const STORAGE_KEY = "zenith_render_probe"

const counts = new Map<string, number>()
const enabledOnLoad = (): boolean => {
  try {
    if (localStorage.getItem(STORAGE_KEY) === "1") return true
  } catch {
    // Storage unavailable: fall back to the runtime mode alone.
  }
  return isDevRuntime()
}

let enabled = enabledOnLoad()
let installed = false

const persists = (on: boolean): void => {
  try {
    if (on) localStorage.setItem(STORAGE_KEY, "1")
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage unavailable: the in-memory toggle still applies for this page.
  }
}

const read = (): Record<string, number> =>
  Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)))

const reset = (): void => { counts.clear() }

/** Count one occurrence of a named event. Cheap no-op while disabled. */
const count = (name: string): void => {
  if (!enabled) return
  counts.set(name, (counts.get(name) ?? 0) + 1)
}

const watch = (seconds = 5): void => {
  if (!enabled) {
    // eslint-disable-next-line no-console -- dev-only diagnostic
    console.warn("[renderProbe] disabled; call __renderProbe.enable() first")
    return
  }
  const before = new Map(counts)
  const report = () => {
    const rows = [...counts.entries()]
      .map(([name, total]) => ({ counter: name, hits: total - (before.get(name) ?? 0), total }))
      .filter((row) => row.hits > 0)
      // Heaviest first: the counter that moves most is the one to fix.
      .sort((a, b) => b.hits - a.hits)
    // eslint-disable-next-line no-console -- dev-only diagnostic
    console.table(rows.length ? rows : [{ counter: "(no counter moved)", hits: 0, total: 0 }])
  }
  setTimeout(report, Math.max(1, seconds) * 1_000)
}

export const renderProbe = {
  isEnabled: (): boolean => enabled,
  enable: (): void => { enabled = true; persists(true) },
  disable: (): void => { enabled = false; persists(false) },
  count,
  read,
  reset,
  watch,
}

/**
 * Count one render of `name`. Call unconditionally — the probe decides whether
 * the counter moves, and hooks must not be conditional.
 */
export function useRenderProbe(name: string): void {
  count(name)
}

declare global {
  interface Window {
    __renderProbe?: typeof renderProbe
  }
}

/** Expose the console API once; safe to call on every module load. */
export function installRenderProbe(): void {
  if (installed || typeof window === "undefined") return
  installed = true
  window.__renderProbe = renderProbe
}

installRenderProbe()
