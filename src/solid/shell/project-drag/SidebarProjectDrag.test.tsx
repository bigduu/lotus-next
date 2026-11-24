import { createSignal, flush } from "solid-js"
import { render } from "@solidjs/web"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { ProjectManifest } from "@services/project"
import { appStore } from "@shared/store/appStore/state"
import type { ChatItem } from "@shared/types/chatMessages"
import { SidebarProjectDrag, type SidebarProjectDragProps } from "./SidebarProjectDrag"

const harness = vi.hoisted(() => ({ manager: undefined as unknown }))
vi.mock("@dnd-kit/dom", async (original) => ({
  ...await original<typeof import("@dnd-kit/dom")>(),
  DragDropManager: function Manager() { return harness.manager },
}))

type SyntheticDragEvent = {
  operation: {
    source: { data: { kind: string; projectId: string; id: string }; element: HTMLElement }
    target: { data: { projectId: string; sectionId: string } }
    position: { current: { x: number; y: number } }
  }
  preventDefault: () => void
  canceled?: boolean
}
type Callback = (event: SyntheticDragEvent) => void
const listeners = new Map<string, Set<Callback>>()
let host: HTMLDivElement
let sourceElement: HTMLButtonElement
let dispose: () => void
let props: SidebarProjectDragProps
let publish: (props: SidebarProjectDragProps) => void
let manager: {
  plugins: never[]
  monitor: { addEventListener: (name: string, callback: Callback) => () => void }
  actions: { stop: ReturnType<typeof vi.fn> }
  destroy: () => void
  dragOperation: {
    controller: AbortController
    status: { initializing: boolean; initialized: boolean; dragging: boolean }
    source: SyntheticDragEvent["operation"]["source"]
  }
}

function run(action: () => unknown) {
  action()
  flush()
}

function emit(name: string, canceled?: boolean) {
  const operation = {
    source: manager.dragOperation.source,
    target: { data: { projectId: "p1", sectionId: "custom" } },
    position: { current: { x: 0, y: 0 } },
  }
  run(() => {
    for (const listener of listeners.get(name) ?? []) listener({ operation, canceled, preventDefault: vi.fn() })
  })
}

function pickup() {
  manager.dragOperation.status.initializing = true
  emit("beforedragstart")
}

beforeEach(() => {
  host = document.body.appendChild(document.createElement("div"))
  sourceElement = host.appendChild(document.createElement("button"))
  const mount = host.appendChild(document.createElement("div"))
  listeners.clear()
  manager = {
    plugins: [],
    monitor: {
      addEventListener: (name, listener) => {
        const callbacks = listeners.get(name) ?? new Set()
        listeners.set(name, callbacks)
        callbacks.add(listener)
        return () => { callbacks.delete(listener) }
      },
    },
    actions: { stop: vi.fn() },
    destroy: vi.fn(),
    dragOperation: {
      controller: new AbortController(),
      status: { initializing: false, initialized: false, dragging: false },
      source: { data: { kind: "session", projectId: "p1", id: "root" }, element: sourceElement },
    },
  }
  harness.manager = manager
  const project = { id: "p1", status: "active", revision: 1,
    sidebar: { sections: [{ id: "custom", name: "Custom" }], session_sections: {}, hidden_legacy: false },
  } as ProjectManifest
  props = {
    projects: { p1: project },
    chats: [{ id: "root", config: { projectId: "p1" } }] as ChatItem[],
    busy: new Set(),
    preferences: { version: 1, projects: { p1: { sections: project.sidebar!.sections, sessionSections: {}, hiddenLegacy: false } } },
    scopeKey: "session-a", onMoveSession: vi.fn(async () => false), onMoveSection: vi.fn(), children: () => null,
  }
  appStore.setState({ projects: props.projects })
  const [scope, setScope] = createSignal(props)
  publish = setScope
  run(() => { dispose = render(() => <SidebarProjectDrag {...scope()} />, mount) })
})

afterEach(() => {
  dispose()
  host.remove()
})

it("cancels navigation during synchronous initialization before delayed drag-start notification", () => {
  pickup()
  run(() => publish({ ...props, scopeKey: "session-b" }))
  expect(manager.actions.stop).toHaveBeenCalledWith({ canceled: true })
  emit("dragend", false)
  expect(props.onMoveSession).not.toHaveBeenCalled()
})

it("cancels an already confirmed revision change while a gesture is held", () => {
  pickup()
  const projects = { p1: { ...props.projects.p1, revision: 2 } }
  appStore.setState({ projects })
  run(() => publish({ ...props, projects }))
  expect(manager.actions.stop).toHaveBeenCalledWith({ canceled: true })
  emit("dragend", false)
  expect(props.onMoveSession).not.toHaveBeenCalled()
})

it.each(["resize", "blur", "contextmenu"])("cancels %s before a default end can commit a pending move", (event) => {
  pickup()
  run(() => (event === "contextmenu" ? document : window).dispatchEvent(new Event(event)))
  expect(manager.actions.stop).toHaveBeenCalledWith({ canceled: true })
  emit("dragend", false)
  expect(props.onMoveSession).not.toHaveBeenCalled()
})

it("cancels when Settings makes the source ancestry inert without opening a dialog", async () => {
  pickup()
  sourceElement.parentElement!.setAttribute("inert", "")
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  expect(manager.actions.stop).toHaveBeenCalledWith({ canceled: true })
  sourceElement.parentElement!.removeAttribute("inert")
  emit("dragend", false)
  expect(props.onMoveSession).not.toHaveBeenCalled()
})

it("commits one valid completed gesture and ignores an explicitly cancelled one", () => {
  pickup()
  emit("dragend", false)
  expect(props.onMoveSession).toHaveBeenCalledExactlyOnceWith(
    { kind: "session", projectId: "p1", id: "root", revision: 1 }, { projectId: "p1", sectionId: "custom" }, false,
  )
  pickup()
  emit("dragend", true)
  expect(props.onMoveSession).toHaveBeenCalledTimes(1)
})
