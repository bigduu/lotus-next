import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from "react"
import { Group, Panel, useGroupRef, type Layout, type LayoutChangedMeta } from "react-resizable-panels"
import { useMediaQuery } from "@shared/hooks/useMediaQuery"
import { uiText, useUiLocale } from "@shared/i18n/ui"
import { ResizeHandle } from "./resize-handle"

type Side = "sidebar" | "workbench"
type WidthPreference = { width: number; setWidth: (width: number) => void }
type ResizeInteraction = { side: Side; pointerId: number | null; layout: Layout; cancelled: boolean }

/** Keep the real surface ancestry stable while their docked columns disappear. */
export function ResizableLayout({ sidebar, children, workbench, sidebarCollapsed, workbenchDocked,
  sidebarWidth, workbenchWidth, workbenchMaxWidth, viewportWidth, suspended, scopeKey,
}: {
  sidebar: ReactNode
  children: ReactNode
  workbench: ReactNode
  sidebarCollapsed: boolean
  workbenchDocked: boolean
  sidebarWidth: WidthPreference
  workbenchWidth: WidthPreference
  workbenchMaxWidth: number
  viewportWidth: number
  suspended: boolean
  scopeKey: string | null
}) {
  useUiLocale()
  const desktopSidebar = useMediaQuery("(min-width: 768px)") && !sidebarCollapsed
  const group = useGroupRef()
  const interaction = useRef<ResizeInteraction | null>(null)
  const element = useRef<HTMLDivElement | null>(null)

  const restoreCancelledResize = useCallback((active: ResizeInteraction) => {
    if (interaction.current !== active) return
    interaction.current = null
    group.current?.setLayout(active.layout)
  }, [group])

  const cancelResize = useCallback(() => {
    const active = interaction.current
    if (!active || active.pointerId === null || active.cancelled) return
    // The library finalizes pointer cancellation as a layout change. Suppress
    // that preference write and restore our pre-gesture layout after cleanup.
    active.cancelled = true
    element.current?.dispatchEvent(new PointerEvent("pointercancel", {
      bubbles: true, pointerId: active.pointerId,
    }))
    restoreCancelledResize(active)
  }, [restoreCancelledResize])

  useEffect(() => {
    const cancel = (event: PointerEvent) => {
      const active = interaction.current
      if (!active || active.pointerId !== event.pointerId || active.cancelled) return
      if (event.type === "lostpointercapture" && (!(event.target instanceof HTMLElement) ||
        event.target.dataset.resizePanel !== active.side)) return
      active.cancelled = true
    }
    const restore = (event: PointerEvent) => {
      const active = interaction.current
      if (active?.cancelled && active.pointerId === event.pointerId) restoreCancelledResize(active)
    }
    const blur = (event: FocusEvent) => {
      if (event.target === window) cancelResize()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && interaction.current?.pointerId != null) {
        event.preventDefault()
        cancelResize()
      }
    }
    const release = (event: PointerEvent) => {
      const active = interaction.current
      if (active?.pointerId === event.pointerId) interaction.current = null
    }
    // Window capture runs before the primitive's document listener, so cancelled
    // or interrupted gestures cannot be mistaken for completed user changes.
    window.addEventListener("pointercancel", cancel, true)
    window.addEventListener("pointercancel", restore)
    window.addEventListener("lostpointercapture", cancel, true)
    window.addEventListener("lostpointercapture", restore)
    window.addEventListener("blur", blur, true)
    window.addEventListener("pagehide", cancelResize, true)
    window.addEventListener("keydown", escape, true)
    // Release in bubble order, after the primitive's completed-layout callback.
    // A microtask from window capture can run before its document listener.
    window.addEventListener("pointerup", release)
    return () => {
      interaction.current = null
      window.removeEventListener("pointercancel", cancel, true)
      window.removeEventListener("pointercancel", restore)
      window.removeEventListener("lostpointercapture", cancel, true)
      window.removeEventListener("lostpointercapture", restore)
      window.removeEventListener("blur", blur, true)
      window.removeEventListener("pagehide", cancelResize, true)
      window.removeEventListener("keydown", escape, true)
      window.removeEventListener("pointerup", release)
    }
  }, [cancelResize, restoreCancelledResize])

  useLayoutEffect(() => {
    cancelResize()
    if (suspended) return
    // Restore pixel preferences after viewport/constraint changes. The library
    // clamps the visible columns; these imperative changes never save storage.
    // Constraint changes register the primitive's new panels in another layout
    // pass. Reconcile after that pass, before the browser paints the columns.
    let current = true
    queueMicrotask(() => {
      if (!current) return
      const available = element.current ? element.current.getBoundingClientRect().width - Number(desktopSidebar) - Number(workbenchDocked) : 0
      if (available <= 0) return
      // The pixel API uses integer offsetWidth measurements. Use the actual
      // available width here to avoid subpixel drift on save/reload cycles.
      const sidebar = desktopSidebar ? sidebarWidth.width / available * 100 : 0
      const workbench = workbenchDocked ? workbenchWidth.width / available * 100 : 0
      group.current?.setLayout({ "sidebar-panel": sidebar, "chat-panel": 100 - sidebar - workbench, "workbench-panel": workbench })
    })
    return () => { current = false }
  }, [cancelResize, desktopSidebar, workbenchDocked, sidebarWidth.width, workbenchWidth.width,
    workbenchMaxWidth, viewportWidth, suspended, scopeKey, group])

  const begin = (target: EventTarget | null, pointerId: number | null) => {
    if (suspended || !(target instanceof HTMLElement)) return false
    const separator = target.closest<HTMLElement>("[data-resize-panel]")
    const side = separator?.dataset.resizePanel as Side | undefined
    const layout = group.current?.getLayout()
    if (!side || !layout) return false
    interaction.current = { side, pointerId, layout, cancelled: false }
    return true
  }
  const saveUserResize = (layout: Layout, meta: LayoutChangedMeta) => {
    const active = interaction.current
    const container = element.current
    if (!meta.isUserInteraction || !active || active.cancelled || suspended || !container) return
    // getSize().inPixels reads DOM size, which still represents the previous
    // React commit here. The completed callback layout is the authoritative size.
    const separators = [...container.children].filter((child) => child.hasAttribute("data-separator"))
    const available = container.getBoundingClientRect().width - separators.reduce((sum, child) => sum + child.getBoundingClientRect().width, 0)
    const width = Math.round(layout[`${active.side}-panel`] / 100 * available * 1000) / 1000
    const preference = active.side === "sidebar" ? sidebarWidth : workbenchWidth
    interaction.current = null
    if (width) preference.setWidth(width)
  }

  // Preserve horizontal content scrolling; only the real separator targets
  // suppress native touch gestures, rather than every panel ancestor.
  return <Group id="chat-panels" groupRef={group} elementRef={element}
    className="min-h-0 min-w-0 flex-1 touch-auto!" disabled={suspended}
    resizeTargetMinimumSize={{ fine: 12, coarse: 28 }} onLayoutChanged={saveUserResize}
    onPointerDownCapture={(event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return
      if (interaction.current?.pointerId != null && interaction.current.pointerId !== event.pointerId) return
      // Prefer the actual handle target. For hits in the primitive's expanded
      // target area, its document capture handler has focused that separator.
      if (!begin(event.target, event.pointerId)) begin(document.activeElement, event.pointerId)
    }}
    onKeyDownCapture={(event) => {
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) begin(event.target, null)
    }}>
    <Panel id="sidebar-panel" minSize={desktopSidebar ? 220 : 0}
      maxSize={desktopSidebar ? 420 : 0} defaultSize={desktopSidebar ? sidebarWidth.width : 0}
      style={{ overflow: "visible" }} className="flex min-h-0 min-w-0 touch-auto!">
      {sidebar}
    </Panel>
    {desktopSidebar ? <ResizeHandle id="sidebar-resize" data-resize-panel="sidebar" aria-label={uiText("resize_sidebar")}
      disabled={suspended} /> : null}
    <Panel id="chat-panel" minSize={desktopSidebar ? 360 : 0} className="flex min-h-0 min-w-0 touch-auto!" style={{ overflow: "hidden" }}>
      {children}
    </Panel>
    {workbenchDocked ? <ResizeHandle id="workbench-resize" data-resize-panel="workbench" aria-label={uiText("resize_workbench")}
      disabled={suspended} /> : null}
    <Panel id="workbench-panel" minSize={workbenchDocked ? 360 : 0}
      maxSize={workbenchDocked ? workbenchMaxWidth : 0} defaultSize={workbenchDocked ? workbenchWidth.width : 0}
      style={{ overflow: "visible" }} className="flex min-h-0 min-w-0 touch-auto!">
      {workbench}
    </Panel>
  </Group>
}
