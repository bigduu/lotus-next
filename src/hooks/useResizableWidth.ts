import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"

const clampWidth = (width: number, min: number, max: number) => Math.min(max, Math.max(min, width))

/**
 * A persisted, pointer-draggable width for a side panel.
 *
 * `edge` is which side the drag handle sits on relative to the panel:
 * - "right" (handle on the panel's right edge, e.g. the left sidebar) → drag
 *   right grows it.
 * - "left" (handle on the panel's left edge, e.g. a right rail) → drag left
 *   grows it.
 */
export function useResizableWidth(
  storageKey: string,
  defaultWidth: number,
  opts: { min: number; max: number; edge: "left" | "right" },
) {
  const { min, max, edge } = opts
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
  const widthRef = useRef(width)
  widthRef.current = width
  const limitsRef = useRef({ min, max })
  limitsRef.current = { min, max }
  const cleanupResizeRef = useRef<(() => void) | null>(null)

  useEffect(() => () => cleanupResizeRef.current?.(), [])

  const startResize = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault()
      cleanupResizeRef.current?.()
      const startX = e.clientX
      const startW = widthRef.current
      const previousCursor = document.body.style.cursor
      const previousUserSelect = document.body.style.userSelect
      let resizedWidth: number | null = null

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX
        const delta = edge === "left" ? -dx : dx
        const limits = limitsRef.current
        const nextWidth = clampWidth(startW + delta, limits.min, limits.max)
        if (nextWidth === widthRef.current) return
        resizedWidth = nextWidth
        // A move and release can arrive before React commits another render.
        widthRef.current = nextWidth
        setPreferredWidth(nextWidth)
      }
      const cleanup = () => {
        window.removeEventListener("pointermove", onMove)
        window.removeEventListener("pointerup", onUp)
        window.removeEventListener("pointercancel", onUp)
        document.body.style.cursor = previousCursor
        document.body.style.userSelect = previousUserSelect
        cleanupResizeRef.current = null
      }
      const onUp = () => {
        cleanup()
        // Clicking the divider without moving it must not save a temporary
        // viewport clamp over the original preferred width.
        if (resizedWidth === null) return
        try {
          localStorage.setItem(storageKey, String(resizedWidth))
        } catch {
          /* ignore */
        }
      }

      window.addEventListener("pointermove", onMove)
      window.addEventListener("pointerup", onUp)
      window.addEventListener("pointercancel", onUp)
      cleanupResizeRef.current = cleanup
      // Keep the resize cursor + suppress text selection for the whole drag.
      document.body.style.cursor = "col-resize"
      document.body.style.userSelect = "none"
    },
    [edge, storageKey],
  )

  return { width, startResize }
}
