import type { BrowserFrame } from "@services/browser/types"

/** Coordinates inside an object-contained frame, in the browser's CSS pixels. */
export const pointInBrowserFrame = (
  clientX: number,
  clientY: number,
  imageRect: Pick<DOMRect, "left" | "top" | "width" | "height">,
  frame: BrowserFrame,
): { x: number; y: number } | null => {
  const scale = Math.min(
    imageRect.width / frame.viewport.width,
    imageRect.height / frame.viewport.height,
  )
  if (!Number.isFinite(scale) || scale <= 0) return null
  const drawnWidth = frame.viewport.width * scale
  const drawnHeight = frame.viewport.height * scale
  const left = imageRect.left + (imageRect.width - drawnWidth) / 2
  const top = imageRect.top + (imageRect.height - drawnHeight) / 2
  const x = (clientX - left) / scale
  const y = (clientY - top) / scale
  if (x < 0 || y < 0 || x >= frame.viewport.width || y >= frame.viewport.height) return null
  return { x: Math.floor(x), y: Math.floor(y) }
}
