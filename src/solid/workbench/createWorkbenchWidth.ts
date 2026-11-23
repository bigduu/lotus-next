import { createMemo, type Accessor } from "solid-js"

import { clampPanelWidth } from "../ui/createPanelWidth"
import { getWorkbenchMaxWidth, MIN_WORKBENCH_WIDTH } from "../ui/resizable-layout"

function readLegacyWidth() {
  try {
    const width = Number(localStorage.getItem("lotus_next_inspector_w"))
    if (Number.isFinite(width) && width > 0) return width
  } catch { /* Use the default when storage is unavailable. */ }
  return 520
}

/** A measured constraint is temporary. Only an accepted resize updates the session preference. */
export function createWorkbenchWidth(
  containerWidth: Accessor<number>,
  sidebarWidth: Accessor<number>,
  preferredWidth: Accessor<number | null>,
  onPreferredWidth: (width: number) => void,
) {
  const defaultWidth = readLegacyWidth()
  const maxWidth = createMemo(() => getWorkbenchMaxWidth(containerWidth(), sidebarWidth()))
  const canDock = createMemo(() => maxWidth() >= MIN_WORKBENCH_WIDTH)
  const clamp = (width: number) => clampPanelWidth(width, { min: MIN_WORKBENCH_WIDTH, max: maxWidth() })
  const width = createMemo(() => canDock() ? clamp(preferredWidth() ?? defaultWidth) : 0)
  const setWidth = (next: number) => {
    if (!canDock() || !Number.isFinite(next) || next <= 0) return
    onPreferredWidth(clamp(next))
  }
  return { width, setWidth, maxWidth, canDock }
}
