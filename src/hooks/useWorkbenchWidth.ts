import { useEffect, useState } from "react"
import { useResizableWidth } from "./useResizableWidth"

export const MIN_WORKBENCH_WIDTH = 360
export const MIN_CHAT_WIDTH = 360

/** Docked panels share the viewport with chat and one or two 1px dividers. */
export function getWorkbenchMaxWidth(viewportWidth: number, sidebarWidth: number): number {
  const dividerWidth = sidebarWidth > 0 ? 2 : 1
  return Math.max(MIN_WORKBENCH_WIDTH, viewportWidth - sidebarWidth - MIN_CHAT_WIDTH - dividerWidth)
}

export function useWorkbenchWidth(sidebarWidth: number) {
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth)
    window.addEventListener("resize", onResize)
    onResize()
    return () => window.removeEventListener("resize", onResize)
  }, [])

  const maxWidth = getWorkbenchMaxWidth(viewportWidth, sidebarWidth)
  const preference = useResizableWidth("lotus_next_inspector_w", 520, {
    min: MIN_WORKBENCH_WIDTH,
    max: maxWidth,
  })
  return { ...preference, maxWidth, viewportWidth }
}
