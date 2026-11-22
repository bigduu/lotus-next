import { useCallback, useState } from "react"

export const MIN_WORKBENCH_WIDTH = 360
export const MIN_CHAT_WIDTH = 360
export const MIN_DOCKED_CHAT_WIDTH = 416

/** Docking requires space for both readable columns and the visible separators. */
export function getWorkbenchMaxWidth(containerWidth: number, sidebarWidth: number): number {
  const dividerWidth = sidebarWidth > 0 ? 2 : 1
  return Math.max(0, containerWidth - sidebarWidth - MIN_DOCKED_CHAT_WIDTH - dividerWidth)
}

function readLegacyWidth() {
  try {
    const width = Number(localStorage.getItem("lotus_next_inspector_w"))
    if (Number.isFinite(width) && width > 0) return width
  } catch { /* Use the default when storage is unavailable. */ }
  return 520
}

export function useWorkbenchWidth(
  containerWidth: number,
  sidebarWidth: number,
  preferredWidth: number | null,
  onPreferredWidth: (width: number) => void,
) {
  const [defaultWidth] = useState(readLegacyWidth)
  const maxWidth = getWorkbenchMaxWidth(containerWidth, sidebarWidth)
  const canDock = maxWidth >= MIN_WORKBENCH_WIDTH
  const width = canDock ? Math.min(maxWidth, Math.max(MIN_WORKBENCH_WIDTH, preferredWidth ?? defaultWidth)) : 0
  const setWidth = useCallback((next: number) => {
    if (!canDock || !Number.isFinite(next) || next <= 0) return
    onPreferredWidth(Math.min(maxWidth, Math.max(MIN_WORKBENCH_WIDTH, next)))
  }, [canDock, maxWidth, onPreferredWidth])
  return { width, setWidth, maxWidth, canDock, containerWidth }
}
