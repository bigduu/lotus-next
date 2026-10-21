import { useLayoutEffect, useRef, useState } from "react"
import { DragDropProvider, useDraggable, useDroppable, useDragDropManager, useDragOperation, type DragOverEvent } from "@dnd-kit/react"
import { GripVertical } from "lucide-react"
import { Feedback } from "@dnd-kit/dom"
import { useUiText } from "@shared/i18n/ui"
import { useAppStore } from "@shared/store/appStore"
import { workbenchSensors } from "./workbenchSensors"
import { workbenchDragCancellation } from "./workbenchDragCancellation"
import {
  sidebarDragSource, sidebarDropTarget, validSidebarSource, validSidebarDrop,
  type SidebarDragPickup, type SidebarDragParts, type SidebarProjectDragProps,
} from "./sidebarDrag"

const Handle: SidebarDragParts["Handle"] = ({ source, label, disabled }) => {
  const { ref, isDragging } = useDraggable({ id: JSON.stringify([source.kind, source.projectId, source.id]), data: source, disabled,
    plugins: [Feedback.configure({ feedback: "clone", dropAnimation: null })] })
  return <button ref={ref} type="button" disabled={disabled} aria-label={label} title={label}
    data-sidebar-drag-handle={`${source.kind}:${source.id}`}
    data-sidebar-dragging={isDragging || undefined}
    className="shrink-0 rounded p-1 text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
    style={{ touchAction: "none", cursor: "grab", opacity: isDragging ? 0.6 : undefined }}
    onClick={(event) => { event.preventDefault(); event.stopPropagation() }}
    onDragStart={(event) => { event.preventDefault(); event.stopPropagation() }}>
    <GripVertical aria-hidden="true" className="size-3" />
  </button>
}

const Target: SidebarDragParts["Target"] = ({ target, disabled, children, style, ...props }) => {
  const { source } = useDragOperation()
  const { ref, isDropTarget } = useDroppable({ id: JSON.stringify(["target", target.projectId, target.sectionId, Object.hasOwn(props, "data-project-drop")]), data: target, disabled })
  const accepted = isDropTarget && sidebarDragSource(source?.data)?.projectId === target.projectId
  return <div {...props} ref={ref} data-sidebar-drop-target data-drop-active={accepted || undefined}
    style={{ ...style, ...(accepted ? { boxShadow: "inset 0 0 0 2px var(--ring)", backgroundColor: "color-mix(in oklab, var(--primary) 5%, transparent)" } : {}) }}>
    {children}
  </div>
}

const parts = { Handle, Target }

/** Observe initialization synchronously; external cancellation also releases 0.5 sensor listeners. */
function Lifecycle({ scopeKey, state, onCancel, getPickup }: { scopeKey: string; state: SidebarProjectDragProps; onCancel: () => void; getPickup: () => SidebarDragPickup | null }) {
  const manager = useDragDropManager()
  const latest = useRef({ scopeKey, state, onCancel })
  latest.current = { scopeKey, state, onCancel }
  const cancel = useRef<() => void>(() => {})
  useLayoutEffect(() => {
    if (!manager) return
    const active = () => !manager.dragOperation.controller?.signal.aborted && (manager.dragOperation.status.initializing || manager.dragOperation.status.dragging)
    const cancellation = workbenchDragCancellation(manager, active)
    cancel.current = () => { latest.current.onCancel(); cancellation.cancel() }
    const externalFocus = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('[role="dialog"], [role="menu"]')) cancel.current()
    }
    const context = () => cancel.current()
    const visibility = () => { if (document.visibilityState !== "visible") cancel.current() }
    document.addEventListener("focusin", externalFocus, true)
    document.addEventListener("contextmenu", context, true)
    // A later pointer gesture owns focus, including during an async save.
    document.addEventListener("pointerdown", context, true)
    document.addEventListener("visibilitychange", visibility)
    window.addEventListener("blur", context)
    // Feedback's keyboard resize handler otherwise ends with canceled:false.
    window.addEventListener("resize", context, true)
    const key = (event: KeyboardEvent) => {
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) cancel.current()
    }
    document.addEventListener("keydown", key, true)
    const observer = new MutationObserver(() => {
      const source = manager.dragOperation.source?.element
      if (active() && (!source?.isConnected || source.closest('[inert], [hidden], [aria-hidden="true"]')
        || document.querySelector('[role="dialog"]:not([data-state="closed"]):not([hidden]), [role="menu"]:not([data-state="closed"]):not([hidden])'))) cancel.current()
    })
    observer.observe(document.body, { childList: true, attributes: true, attributeFilter: ["inert", "hidden", "aria-hidden"], subtree: true })
    return () => {
      cancel.current()
      cancellation.dispose()
      document.removeEventListener("focusin", externalFocus, true)
      document.removeEventListener("contextmenu", context, true)
      document.removeEventListener("pointerdown", context, true)
      document.removeEventListener("visibilitychange", visibility)
      document.removeEventListener("keydown", key, true)
      window.removeEventListener("blur", context)
      window.removeEventListener("resize", context, true)
      observer.disconnect()
    }
  }, [manager])
  useLayoutEffect(() => { cancel.current() }, [scopeKey])
  useLayoutEffect(() => {
    const source = sidebarDragSource(manager?.dragOperation.source?.data)
    const pickup = getPickup()
    if (source && pickup && !validSidebarSource(source, { ...state, projects: useAppStore.getState().projects }, pickup.revision)) cancel.current()
  }, [manager, state, getPickup])
  return null
}

export default function SidebarProjectDrag(props: SidebarProjectDragProps) {
  const uiText = useUiText()
  const pickup = useRef<SidebarDragPickup | null>(null)
  const focusVersion = useRef(0)
  const latest = useRef(props)
  latest.current = props
  const [notice, setNotice] = useState(false)
  const [returnFocus, setReturnFocus] = useState<{
    source: SidebarDragPickup; sidebar: Element | null | undefined; sourceElement: Element | undefined; scope: string; version: number
  } | null>(null)
  useLayoutEffect(() => {
    if (!returnFocus) return
    const { source, sidebar, sourceElement, scope, version } = returnFocus
    if (version !== focusVersion.current || props.scopeKey !== scope
      || (document.activeElement !== document.body && document.activeElement !== sourceElement)) {
      setReturnFocus(null)
      return
    }
    if (props.busy.has(source.projectId)) return
    if (!validSidebarSource(source, { ...props, projects: useAppStore.getState().projects })) {
      setReturnFocus(null)
      return
    }
    const handle = [...sidebar?.querySelectorAll<HTMLElement>(`[data-sidebar-drag-handle="session:${CSS.escape(source.id)}"]`) ?? []]
      .find((element) => element.isConnected && element.getClientRects().length > 0 && !element.closest('[inert], [hidden], [aria-hidden="true"]'))
    if (handle) {
      handle.focus()
      setReturnFocus(null)
    }
  }, [returnFocus, props])
  const currentState = () => ({ ...props, projects: useAppStore.getState().projects })
  const clear = () => { pickup.current = null; focusVersion.current += 1; setNotice(false); setReturnFocus(null) }
  const check = (operation: DragOverEvent["operation"]) => {
    const target = sidebarDropTarget(operation.target?.data)
    setNotice(!!pickup.current && !!target && pickup.current.projectId !== target.projectId)
  }
  return <DragDropProvider sensors={workbenchSensors}
    onBeforeDragStart={(event) => {
      const source = sidebarDragSource(event.operation.source?.data)
      clear()
      if (!source || !validSidebarSource(source, currentState())) { event.preventDefault(); return }
      pickup.current = { ...source, revision: currentState().projects[source.projectId]!.revision }
    }}
    onDragOver={(event) => check(event.operation)}
    onDragEnd={(event) => {
      const source = pickup.current
      const target = sidebarDropTarget(event.operation.target?.data)
      clear()
      if (event.canceled || !source || !target || !validSidebarDrop(source, target, currentState())) return
      if (source.kind === "session") {
        const sourceElement = event.operation.source?.element
        const sidebar = sourceElement?.closest("aside")
        const scope = props.scopeKey
        const version = focusVersion.current
        void props.onMoveSession(source, target).then((saved) => {
          if (saved && version === focusVersion.current && latest.current.scopeKey === scope) {
            setReturnFocus({ source, sidebar, sourceElement, scope, version })
          }
        })
      }
      else {
        const element = event.operation.target?.element
        const header = element?.querySelector("[data-sidebar-section-header]") ?? element
        const bounds = header?.getBoundingClientRect()
        const after = !!bounds && event.operation.position.current.y > bounds.top + bounds.height / 2
        props.onMoveSection(source, target, after)
      }
    }}>
    <Lifecycle scopeKey={props.scopeKey} state={props} onCancel={clear} getPickup={() => pickup.current} />
    {notice ? <p role="status" className="px-3 py-2 text-xs text-muted-foreground">{uiText("sidebar_cross_project_drop_unavailable")}</p> : null}
    {props.children(parts)}
  </DragDropProvider>
}
