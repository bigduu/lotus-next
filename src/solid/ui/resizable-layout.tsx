import { createEffect, createMemo, createSignal, onSettled, Show } from "solid-js"
import type { JSX } from "@solidjs/web"

import { uiText } from "@shared/i18n/text"

import { ResizeHandle } from "./resize-handle"

export const MIN_WORKBENCH_WIDTH = 360
export const MIN_CHAT_WIDTH = 360
export const MIN_DOCKED_CHAT_WIDTH = 416

export function getWorkbenchMaxWidth(containerWidth: number, sidebarWidth: number): number {
  return Math.max(0, containerWidth - sidebarWidth - MIN_DOCKED_CHAT_WIDTH - (sidebarWidth > 0 ? 2 : 1))
}

type Side = "sidebar" | "workbench"
type WidthPreference = { width: number; setWidth: (width: number) => void }
type WidthBounds = { min: number; max: number }

interface ResizeGesture {
  side: Side
  pointerId: number
  handle: HTMLDivElement
  from: number
  width: number
  bounds: WidthBounds
}

interface ResizableLayoutProps {
  sidebar: JSX.Element
  children: JSX.Element
  workbench: JSX.Element
  desktopSidebar: boolean
  workbenchDocked: boolean
  sidebarWidth: WidthPreference
  workbenchWidth: WidthPreference
  workbenchMaxWidth: number
  containerWidth: number
  suspended: boolean
  scopeKey: string | null
}

const clampWidth = (width: number, { min, max }: WidthBounds) => Math.min(max, Math.max(min, width))
const roundedWidth = (width: number) => Math.round(width * 1000) / 1000

export function ResizableLayout(props: ResizableLayoutProps) {
  let gesture: ResizeGesture | undefined
  const [preview, setPreview] = createSignal<{ side: Side; width: number }>()
  const display = createMemo(() => {
    const minimumChat = props.workbenchDocked ? MIN_DOCKED_CHAT_WIDTH : props.desktopSidebar ? MIN_CHAT_WIDTH : 0
    const separators = Number(props.desktopSidebar) + Number(props.workbenchDocked)
    const space = props.containerWidth > 0 ? Math.max(0, props.containerWidth - minimumChat - separators) : Infinity
    const sidebar = props.desktopSidebar
      ? Math.min(space, clampWidth(props.sidebarWidth.width, { min: 220, max: 420 }))
      : 0
    const workbench = props.workbenchDocked
      ? Math.max(0, Math.min(
        space - sidebar,
        clampWidth(props.workbenchWidth.width, { min: MIN_WORKBENCH_WIDTH, max: props.workbenchMaxWidth }),
      ))
      : 0

    return { sidebar, workbench, space }
  })

  const visibleWidth = (side: Side) => {
    const active = preview()
    return active?.side === side ? active.width : display()[side]
  }

  const boundsFor = (side: Side): WidthBounds => {
    const current = display()
    const max = Math.max(0, side === "sidebar"
      ? Math.min(420, current.space - current.workbench)
      : Math.min(props.workbenchMaxWidth, current.space - current.sidebar))
    return { min: Math.min(max, side === "sidebar" ? 220 : MIN_WORKBENCH_WIDTH), max }
  }

  const cancelGesture = () => {
    const active = gesture
    if (!active) return
    gesture = undefined
    setPreview(undefined)
    if (active.handle.hasPointerCapture(active.pointerId)) active.handle.releasePointerCapture(active.pointerId)
  }

  createEffect(
    () => [props.scopeKey, props.suspended, props.desktopSidebar, props.workbenchDocked, props.containerWidth,
      props.sidebarWidth.width, props.workbenchWidth.width, props.workbenchMaxWidth],
    cancelGesture,
  )

  onSettled(() => {
    const escape = (event: KeyboardEvent) => {
      if (!gesture || event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      cancelGesture()
    }
    window.addEventListener("keydown", escape, true)
    window.addEventListener("blur", cancelGesture)
    window.addEventListener("pagehide", cancelGesture)
    return () => {
      cancelGesture()
      window.removeEventListener("keydown", escape, true)
      window.removeEventListener("blur", cancelGesture)
      window.removeEventListener("pagehide", cancelGesture)
    }
  })

  const changeWidth = (side: Side, width: number) => {
    if (props.suspended || width === display()[side]) return
    const preference = side === "sidebar" ? props.sidebarWidth : props.workbenchWidth
    preference.setWidth(roundedWidth(width))
  }

  const widthAt = (active: ResizeGesture, x: number) =>
    clampWidth(active.width + (x - active.from) * (active.side === "sidebar" ? 1 : -1), active.bounds)

  const handle = (side: Side) => {
    const id = `${side}-resize`
    return (
      <ResizeHandle
        id={id}
        data-resize-panel={side}
        aria-label={uiText(side === "sidebar" ? "resize_sidebar" : "resize_workbench")}
        aria-controls={`${side}-panel`}
        aria-valuemin={roundedWidth(boundsFor(side).min)}
        aria-valuemax={roundedWidth(boundsFor(side).max)}
        aria-valuenow={roundedWidth(visibleWidth(side))}
        disabled={props.suspended}
        onPointerDown={(event) => {
          if (props.suspended || gesture || (event.pointerType === "mouse" && event.button !== 0)) return
          const element = event.currentTarget
          try {
            element.setPointerCapture(event.pointerId)
          } catch {
            return
          }
          gesture = { side, pointerId: event.pointerId, from: event.clientX, handle: element, width: display()[side], bounds: boundsFor(side) }
          element.focus({ preventScroll: true })
          event.preventDefault()
        }}
        onPointerMove={(event) => {
          if (gesture?.pointerId !== event.pointerId) return
          setPreview({ side, width: widthAt(gesture, event.clientX) })
        }}
        onPointerUp={(event) => {
          if (gesture?.pointerId !== event.pointerId) return
          const width = widthAt(gesture, event.clientX)
          cancelGesture()
          changeWidth(side, width)
        }}
        onPointerCancel={(event) => {
          if (gesture?.pointerId === event.pointerId) cancelGesture()
        }}
        onLostPointerCapture={(event) => {
          if (gesture?.pointerId === event.pointerId) cancelGesture()
        }}
        onKeyDown={(event) => {
          if (props.suspended) return
          const bounds = boundsFor(side)
          const direction = side === "sidebar" ? 1 : -1
          const step = props.containerWidth * 0.05 || 10
          let next: number
          switch (event.key) {
            case "Home": next = bounds.min; break
            case "End": next = bounds.max; break
            case "ArrowLeft": next = visibleWidth(side) - direction * step; break
            case "ArrowRight": next = visibleWidth(side) + direction * step; break
            default: return
          }
          event.preventDefault()
          changeWidth(side, clampWidth(next, bounds))
        }}
      />
    )
  }

  return (
    <div id="chat-panels" class="flex min-h-0 min-w-0 flex-1 touch-auto">
      <div id="sidebar-panel" class="flex min-h-0 min-w-0 shrink-0 touch-auto" style={{ width: `${visibleWidth("sidebar")}px` }}>
        {props.sidebar}
      </div>
      <Show when={props.desktopSidebar}>{handle("sidebar")}</Show>
      <div id="chat-panel" class="flex min-h-0 min-w-0 flex-1 overflow-hidden touch-auto">
        {props.children}
      </div>
      <Show when={props.workbenchDocked}>{handle("workbench")}</Show>
      <div id="workbench-panel" class="flex min-h-0 min-w-0 shrink-0 touch-auto" style={{ width: `${visibleWidth("workbench")}px` }}>
        {props.workbench}
      </div>
    </div>
  )
}
