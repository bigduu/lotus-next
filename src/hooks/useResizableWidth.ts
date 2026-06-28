import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"

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
  const clamp = (n: number) => Math.min(max, Math.max(min, n))

  const [width, setWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      const n = saved ? parseInt(saved, 10) : NaN
      if (!Number.isNaN(n)) return clamp(n)
    } catch {
      /* ignore */
    }
    return defaultWidth
  })
  const widthRef = useRef(width)
  widthRef.current = width

  const startResize = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startW = widthRef.current

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX
        const delta = edge === "left" ? -dx : dx
        setWidth(clamp(startW + delta))
      }
      const onUp = () => {
        window.removeEventListener("pointermove", onMove)
        window.removeEventListener("pointerup", onUp)
        document.body.style.cursor = ""
        document.body.style.userSelect = ""
        try {
          localStorage.setItem(storageKey, String(widthRef.current))
        } catch {
          /* ignore */
        }
      }

      window.addEventListener("pointermove", onMove)
      window.addEventListener("pointerup", onUp)
      // Keep the resize cursor + suppress text selection for the whole drag.
      document.body.style.cursor = "col-resize"
      document.body.style.userSelect = "none"
    },
    // clamp closes over min/max which are stable per call site
    [edge, storageKey], // eslint-disable-line react-hooks/exhaustive-deps
  )

  return { width, startResize }
}
