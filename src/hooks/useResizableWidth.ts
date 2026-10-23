import { useCallback, useState } from "react"

const clampWidth = (width: number, min: number, max: number) => Math.min(max, Math.max(min, width))

/**
 * A side panel's preferred pixel width. Interaction belongs to the resizable
 * panel primitive; only a completed user resize calls `setWidth`.
 */
export function useResizableWidth(
  storageKey: string,
  defaultWidth: number,
  opts: { min: number; max: number },
) {
  const { min, max } = opts
  // Keep the user's preferred width separate from its current layout limit. A
  // smaller window or an expanded sidebar must not erase a wider preference.
  const [preferredWidth, setPreferredWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      const n = saved ? Number(saved) : NaN
      if (Number.isFinite(n) && n > 0) return n
    } catch {
      /* ignore */
    }
    return defaultWidth
  })
  const width = clampWidth(preferredWidth, min, max)
  const setWidth = useCallback((next: number) => {
    if (!Number.isFinite(next) || next <= 0) return
    const savedWidth = clampWidth(next, min, max)
    setPreferredWidth(savedWidth)
    try {
      localStorage.setItem(storageKey, String(savedWidth))
    } catch {
      /* Best-effort preference: keep resizing usable without storage. */
    }
  }, [storageKey, min, max])

  return { width, setWidth }
}
