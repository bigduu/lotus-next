import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react"
import { FocusScope } from "@radix-ui/react-focus-scope"
import { DismissableLayer } from "@radix-ui/react-dismissable-layer"
import { hideOthers } from "aria-hidden"
import { RemoveScroll } from "react-remove-scroll"
import { uiText, useUiLocale } from "@shared/i18n/ui"
import { cn } from "@/lib/utils"
import { WorkbenchTabDragContext, type WorkbenchTabDrag } from "./workbenchSurfaceContext"

function canRestoreFocus(target: HTMLElement | null): target is HTMLElement {
  if (!target?.isConnected || target === document.body || target.matches(":disabled") || target.closest('[hidden], [inert], [aria-hidden="true"]')) return false
  for (let node: HTMLElement | null = target; node; node = node.parentElement) {
    const style = getComputedStyle(node)
    if (style.display === "none" || style.visibility === "hidden") return false
  }
  return true
}

// Work content can be owned by ChatPane and portaled into this DOM subtree.
// Include only explicitly controlled open surfaces, never unrelated body portals.
function workbenchSurfaces(panel: HTMLElement): HTMLElement[] {
  const surfaces = new Set<HTMLElement>([panel])
  for (const surface of surfaces) {
    for (const trigger of surface.querySelectorAll('[aria-expanded="true"][aria-controls]')) {
      for (const id of trigger.getAttribute("aria-controls")!.split(/\s+/)) {
        const controlled = panel.ownerDocument.getElementById(id)
        if (controlled) surfaces.add(controlled)
      }
    }
  }
  return [...surfaces]
}

export function RightWorkbenchSurface({ children, visible = true, pageVisible = true, docked = false, width,
  onClose, focusScopeKey, getCurrentFocusScope, interactionSuspended = false,
}: {
  children: ReactNode
  visible?: boolean
  pageVisible?: boolean
  interactionSuspended?: boolean
  docked?: boolean
  width?: number
  onClose: () => void
  focusScopeKey?: string | null
  getCurrentFocusScope?: () => string | null
}) {
  useUiLocale()
  const draggingTab = useRef<WorkbenchTabDrag | null>(null)
  useEffect(() => () => { draggingTab.current?.cancel() }, [visible, pageVisible, focusScopeKey])
  useLayoutEffect(() => {
    if (interactionSuspended) draggingTab.current?.cancel()
  }, [interactionSuspended])
  // Keep the real React ancestry stable across breakpoints. Moving a portal
  // under a newly mounted Dialog leaves nested Popover scopes outside that
  // Dialog's lifecycle and can create competing focus traps.
  const panelRef = useRef<HTMLElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const pointerDismiss = useRef<"backdrop" | "other" | null>(null)
  const focusGeneration = useRef({ generation: 0 })
  const modal = visible && pageVisible && !docked
  const currentMode = useRef({ docked, visible, pageVisible })
  currentMode.current = { docked, visible, pageVisible }
  useEffect(() => {
    const panel = panelRef.current
    if (!modal || !panel) return
    const lifecycle = focusGeneration.current
    const generation = ++lifecycle.generation
    pointerDismiss.current = null
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const fallback = document.querySelector<HTMLElement>('[aria-controls="right-workbench"]')
    // A model/menu portal may already be open when the viewport narrows.
    // Keep that owned surface exposed to assistive technology as well.
    const surfaces = workbenchSurfaces(panel)
    const restoreBackground = hideOthers(surfaces)
    if (!surfaces.some((surface) => surface.contains(document.activeElement))) {
      panel.focus({ preventScroll: true })
    }
    return () => {
      restoreBackground()
      // Settings owns focus while the chat shell is hidden. Keep the panel
      // mounted, but release its modal effects without focusing hidden controls.
      if (!currentMode.current.pageVisible) return
      // Resizing back to a docked surface must not move focus out of the editor.
      if (currentMode.current.docked && currentMode.current.visible) return
      const restore = () => {
        if (generation !== lifecycle.generation || (getCurrentFocusScope && getCurrentFocusScope() !== focusScopeKey)) return
        const active = document.activeElement
        // Never steal focus from a new control chosen after the close gesture.
        if (active instanceof HTMLElement && !panel.contains(active) && canRestoreFocus(active)) return
        const target = [opener, fallback].find(canRestoreFocus)
        target?.focus({ preventScroll: true })
      }
      if (pointerDismiss.current === "backdrop") {
        // Native pointer default actions run after React's dismissal cleanup and
        // can move focus to BODY. Restore after that turn, only if still vacant.
        requestAnimationFrame(() => {
          const currentPanel = document.getElementById("right-workbench")
          if (currentPanel && canRestoreFocus(currentPanel)) return
          restore()
        })
      } else if (pointerDismiss.current !== "other") restore()
    }
  }, [modal, focusScopeKey, getCurrentFocusScope])

  return <WorkbenchTabDragContext.Provider value={draggingTab}>
    {modal ? <div ref={backdropRef} data-slot="dialog-overlay" className="fixed inset-0 z-40 bg-black/50" style={{ pointerEvents: "auto" }} /> : null}
    <RemoveScroll enabled={modal} forwardProps allowPinchZoom>
      <FocusScope asChild loop={modal} trapped={modal}
        onMountAutoFocus={(event) => event.preventDefault()}
        onUnmountAutoFocus={(event) => event.preventDefault()}>
        <DismissableLayer asChild disableOutsidePointerEvents={modal}
          onDismiss={modal ? onClose : undefined}
          onEscapeKeyDown={(event) => {
            // Radix's document capture listener runs before the keyboard sensor.
            // Let that sensor cancel the drag without also dismissing the pane.
            if (draggingTab.current?.isActive()) event.preventDefault()
          }}
          onFocusOutside={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => {
            const original = event.detail.originalEvent
            // Radix's React capture flag cannot see a sibling-owned portal.
            // Physical/explicitly owned inside targets must not dismiss the pane.
            const panel = panelRef.current
            const target = original.target
            if (panel && target instanceof Node && workbenchSurfaces(panel).some((surface) => surface.contains(target))) {
              event.preventDefault()
              return
            }
            if (original.button === 2 || (original.button === 0 && original.ctrlKey)) {
              event.preventDefault()
              return
            }
            pointerDismiss.current = target instanceof Node && backdropRef.current?.contains(target) ? "backdrop" : "other"
          }}>
          <aside ref={panelRef} id="right-workbench" role={modal ? "dialog" : undefined}
            aria-modal={modal ? true : undefined} aria-label={uiText("workbench_c2730bc7")}
            hidden={!visible}
            className={cn("flex min-h-0 min-w-0 flex-col bg-card", docked ? "shrink-0 border-l" : "fixed inset-y-0 right-0 z-50 border-l shadow-lg")}
            style={{ ...(docked ? { width: width ?? 520 } : { width: "92vw", maxWidth: "42rem" }), display: visible ? undefined : "none" }}>
            {children}
          </aside>
        </DismissableLayer>
      </FocusScope>
    </RemoveScroll>
  </WorkbenchTabDragContext.Provider>
}
