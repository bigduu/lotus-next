import { DragDropManager, Draggable, Droppable, Feedback } from "@dnd-kit/dom"
import { GripVertical } from "@lucide/solid"
import { createEffect, createMemo, createSignal, omit, onSettled, type Component } from "solid-js"
import type { ComponentProps, JSX } from "@solidjs/web"
import { appStore } from "@shared/store/appStore/state"
import {
  sidebarDragSource, sidebarDropTarget, validSidebarDrop, validSidebarSource,
  type SidebarDragPickup, type SidebarDragSource, type SidebarDragState, type SidebarDropTarget,
} from "@/lib/workbench/sidebarDrag"
import { workbenchDragCancellation } from "@/lib/workbench/workbenchDragCancellation"
import { workbenchSensors } from "@/lib/workbench/workbenchSensors"
import { createUiText } from "../uiText"

interface HandleProps {
  source: SidebarDragSource
  label: string
  disabled?: boolean
}

type TargetProps = ComponentProps<"div"> & {
  target: SidebarDropTarget
  disabled?: boolean
  "data-project-drop"?: string
}

export interface SidebarDragParts {
  Handle: Component<HandleProps>
  Target: Component<TargetProps>
}

export type SidebarProjectDragProps = SidebarDragState & {
  scopeKey: string
  onMoveSession: (pickup: SidebarDragPickup, target: SidebarDropTarget, after?: boolean) => Promise<boolean>
  onMoveSection: (pickup: SidebarDragPickup, target: SidebarDropTarget, after: boolean) => void
  children: (parts: SidebarDragParts) => JSX.Element
}

interface FocusReturn {
  source: SidebarDragPickup
  sidebar: Element | null | undefined
  sourceElement: Element | undefined
  scope: string
  version: number
}

const HIDDEN = '[inert], [hidden], [aria-hidden="true"]'
const FOCUS_LAYER = '[role="dialog"], [role="menu"]'
const OPEN_LAYER = '[role="dialog"]:not([data-state="closed"]):not([hidden]), [role="menu"]:not([data-state="closed"]):not([hidden])'
const CLONE_WITHOUT_DROP_ANIMATION = Feedback.configure({ feedback: "clone", dropAnimation: null })

const sourceId = (source: SidebarDragSource) => JSON.stringify([source.kind, source.projectId, source.id])

/** Choose a row position within the drop bucket without making nested rows droppables. */
function rowUnderPointer(target: Element | undefined, position: { x: number; y: number }) {
  const { x, y } = position
  if (!target || !Number.isFinite(x) || !Number.isFinite(y)) return null
  for (const element of document.elementsFromPoint(x, y)) {
    const row = element.closest<HTMLElement>("[data-sidebar-session]")
    const sessionId = row?.dataset.sidebarSession
    if (!row || !sessionId || !target.contains(row)) continue
    const { top, height } = row.getBoundingClientRect()
    return { sessionId, after: y > top + height / 2 }
  }
  return null
}

function highlightedStyle(style: TargetProps["style"], active: boolean) {
  if (!active) return style
  const shadow = "inset 0 0 0 2px var(--ring)"
  const background = "color-mix(in oklab, var(--primary) 5%, transparent)"
  return typeof style === "string"
    ? `${style};box-shadow:${shadow};background-color:${background}`
    : { ...(typeof style === "object" ? style : undefined), "box-shadow": shadow, "background-color": background }
}

export function SidebarProjectDrag(props: SidebarProjectDragProps) {
  const text = createUiText()
  const manager = new DragDropManager({ sensors: workbenchSensors })
  const currentState = (): SidebarDragState => ({
    projects: appStore.getState().projects, chats: props.chats, preferences: props.preferences, busy: props.busy,
  })
  let pickup: SidebarDragPickup | null = null
  let focusVersion = 0
  const [dragging, setDragging] = createSignal<string | null>(null)
  const [over, setOver] = createSignal<{ id: string | null; crossProject: boolean }>({ id: null, crossProject: false })
  const [returnFocus, setReturnFocus] = createSignal<FocusReturn | null>(null)

  const clear = () => {
    pickup = null
    focusVersion += 1
    setDragging(null)
    setOver({ id: null, crossProject: false })
    setReturnFocus(null)
  }
  const sensorActive = () => {
    const operation = manager.dragOperation
    return !operation.controller?.signal.aborted && (operation.status.initializing || operation.status.initialized || operation.status.dragging)
  }
  const cancellation = workbenchDragCancellation(manager, sensorActive)
  const cancel = () => { clear(); cancellation.cancel() }

  function Handle(input: HandleProps) {
    let element!: HTMLButtonElement
    let entity: Draggable | undefined
    const id = createMemo(() => sourceId(input.source))
    const active = () => dragging() === id()
    onSettled(() => {
      const item = new Draggable({
        id: id(), data: input.source, element, disabled: input.disabled === true, plugins: [CLONE_WITHOUT_DROP_ANIMATION],
      }, manager)
      entity = item
      return () => {
        if (manager.dragOperation.source === item && sensorActive()) cancel()
        entity = undefined
        item.destroy()
      }
    })
    createEffect(() => ({ id: id(), source: input.source, disabled: input.disabled === true }), ({ id, source, disabled }) => {
      if (!entity) return
      entity.id = id
      entity.data = source
      entity.disabled = disabled
    })
    return <button ref={(handle) => { element = handle }} type="button" disabled={input.disabled}
      aria-label={input.label} title={input.label} data-sidebar-drag-handle={`${input.source.kind}:${input.source.id}`}
      data-sidebar-dragging={active() ? "true" : undefined}
      class="shrink-0 rounded p-1 text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      style={{ "touch-action": "none", cursor: "grab", opacity: active() ? "0.6" : undefined }}
      onClick={(event) => { event.preventDefault(); event.stopPropagation() }}
      onDragStart={(event) => { event.preventDefault(); event.stopPropagation() }}>
      <GripVertical aria-hidden="true" class="size-3" />
    </button>
  }

  function Target(input: TargetProps) {
    let element!: HTMLDivElement
    let entity: Droppable | undefined
    const id = createMemo(() => JSON.stringify(["target", input.target.projectId, input.target.sectionId, input["data-project-drop"] !== undefined]))
    const active = () => over().id === id() && !over().crossProject
    onSettled(() => {
      const item = new Droppable({ id: id(), data: input.target, element, disabled: input.disabled === true }, manager)
      entity = item
      return () => {
        entity = undefined
        item.destroy()
      }
    })
    createEffect(() => ({ id: id(), target: input.target, disabled: input.disabled === true }), ({ id, target, disabled }) => {
      if (!entity) return
      entity.id = id
      entity.data = target
      entity.disabled = disabled
    })
    return <div {...omit(input, "target", "disabled", "style", "children", "ref")} ref={(target) => { element = target }}
      data-sidebar-drop-target="" data-drop-active={active() ? "true" : undefined} style={highlightedStyle(input.style, active())}>
      {input.children}
    </div>
  }

  const children = { Handle, Target }

  createEffect(() => props.scopeKey, () => cancel())
  createEffect(
    () => [props.projects, props.chats, props.preferences, props.busy] as const,
    () => { if (pickup && !validSidebarSource(pickup, currentState(), pickup.revision)) cancel() },
  )
  createEffect(
    () => ({ focus: returnFocus(), scope: props.scopeKey, busy: props.busy, projects: props.projects }),
    ({ focus, scope, busy }) => {
      if (!focus) return
      const { source, sidebar, sourceElement, version } = focus
      if (version !== focusVersion || focus.scope !== scope
        || (document.activeElement !== document.body && document.activeElement !== sourceElement)) {
        setReturnFocus(null)
        return
      }
      if (busy.has(source.projectId)) return
      if (!validSidebarSource(source, currentState())) {
        setReturnFocus(null)
        return
      }
      const frame = requestAnimationFrame(() => {
        if (version !== focusVersion || props.scopeKey !== scope
          || (document.activeElement !== document.body && document.activeElement !== sourceElement)) return
        const handles = sidebar?.querySelectorAll<HTMLElement>(`[data-sidebar-drag-handle="session:${CSS.escape(source.id)}"]`)
        const handle = Array.from(handles ?? []).find((element) =>
          element.isConnected && element.getClientRects().length > 0 && !element.closest(HIDDEN),
        )
        handle?.focus()
        setReturnFocus(null)
      })
      return () => cancelAnimationFrame(frame)
    },
  )

  onSettled(() => {
    const listen = manager.monitor.addEventListener.bind(manager.monitor)
    const dispose = [
      listen("beforedragstart", (event) => {
        const source = sidebarDragSource(event.operation.source?.data)
        clear()
        const state = currentState()
        if (!source || !validSidebarSource(source, state)) { event.preventDefault(); return }
        pickup = { ...source, revision: state.projects[source.projectId]!.revision }
      }),
      listen("dragstart", () => {
        if (pickup) setDragging(sourceId(pickup))
      }),
      listen("dragover", ({ operation }) => {
        const target = sidebarDropTarget(operation.target?.data)
        setOver({
          id: typeof operation.target?.id === "string" ? operation.target.id : null,
          crossProject: !!pickup && !!target && pickup.projectId !== target.projectId,
        })
      }),
      listen("dragend", (event) => {
        const source = pickup
        const operation = event.operation
        const zone = sidebarDropTarget(operation.target?.data)
        clear()
        if (event.canceled || !source || !zone || !validSidebarDrop(source, zone, currentState())) return
        if (source.kind === "section") {
          const element = operation.target?.element
          const header = element?.querySelector("[data-sidebar-section-header]") ?? element
          const bounds = header?.getBoundingClientRect()
          props.onMoveSection(source, zone, !!bounds && operation.position.current.y > bounds.top + bounds.height / 2)
          return
        }
        const row = rowUnderPointer(operation.target?.element, operation.position.current)
        const target = row && row.sessionId !== source.id ? { ...zone, sessionId: row.sessionId } : zone
        const sourceElement = operation.source?.element
        const sidebar = sourceElement?.closest("aside")
        const scope = props.scopeKey
        const version = focusVersion
        void props.onMoveSession(source, target, row?.after ?? false).then((saved) => {
          if (saved && version === focusVersion && props.scopeKey === scope) {
            setReturnFocus({ source, sidebar, sourceElement, scope, version })
          }
        })
      }),
    ]
    const externalFocus = (event: FocusEvent) => {
      if (event.target instanceof Element && event.target.closest(FOCUS_LAYER)) cancel()
    }
    const visibility = () => { if (document.visibilityState !== "visible") cancel() }
    const key = (event: KeyboardEvent) => {
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) cancel()
    }
    const observer = new MutationObserver(() => {
      const source = manager.dragOperation.source?.element
      if (sensorActive() && (!source?.isConnected || source.closest(HIDDEN) || document.querySelector(OPEN_LAYER))) cancel()
    })
    observer.observe(document.body, { childList: true, attributes: true, attributeFilter: ["inert", "hidden", "aria-hidden"], subtree: true })
    document.addEventListener("focusin", externalFocus, true)
    document.addEventListener("contextmenu", cancel, true)
    document.addEventListener("pointerdown", cancel, true)
    document.addEventListener("visibilitychange", visibility)
    document.addEventListener("keydown", key, true)
    window.addEventListener("blur", cancel)
    window.addEventListener("resize", cancel, true)
    return () => {
      cancel()
      observer.disconnect()
      for (const unsubscribe of dispose) unsubscribe()
      cancellation.dispose()
      document.removeEventListener("focusin", externalFocus, true)
      document.removeEventListener("contextmenu", cancel, true)
      document.removeEventListener("pointerdown", cancel, true)
      document.removeEventListener("visibilitychange", visibility)
      document.removeEventListener("keydown", key, true)
      window.removeEventListener("blur", cancel)
      window.removeEventListener("resize", cancel, true)
      manager.destroy()
    }
  })

  return <>
    {over().crossProject ? <p role="status" class="px-3 py-2 text-xs text-muted-foreground">{text("sidebar_cross_project_drop_unavailable")}</p> : null}
    {props.children(children)}
  </>
}
