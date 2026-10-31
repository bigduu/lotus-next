import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { SidebarProjectDragProps } from "./sidebarDrag"
import type { ProjectManifest } from "@services/project"
import type { ChatItem } from "@shared/types/chatMessages"

const harness = vi.hoisted(() => ({ provider: null as Record<string, (event: unknown) => void> | null, manager: null as unknown }))
vi.mock("@dnd-kit/react", () => ({
  DragDropProvider: ({ children, ...events }: Record<string, unknown>) => { harness.provider = events as typeof harness.provider; return children },
  useDragDropManager: () => harness.manager,
  useDragOperation: () => ({ source: null }),
  useDraggable: () => ({ ref: () => {}, isDragging: false }),
  useDroppable: () => ({ ref: () => {}, isDropTarget: false }),
  KeyboardSensor: class {}, PointerSensor: class {},
}))
import SidebarProjectDrag from "./SidebarProjectDrag"
import { useAppStore } from "@shared/store/appStore"

let root: Root
let host: HTMLDivElement
let props: SidebarProjectDragProps
let sourceElement: HTMLButtonElement
let manager: {
  plugins: never[]
  monitor: { addEventListener: ReturnType<typeof vi.fn> }
  actions: { stop: ReturnType<typeof vi.fn> }
  dragOperation: { controller: AbortController; status: { initializing: boolean; dragging: boolean }; source: { data: { kind: string; projectId: string; id: string }; element: HTMLElement } }
}
const operation = () => ({ source: manager.dragOperation.source, target: { data: { projectId: "p1", sectionId: "custom" } }, position: { current: { y: 0 } } })
const render = () => act(() => root.render(<SidebarProjectDrag {...props} />))
const pickup = () => act(() => {
  manager.dragOperation.status.initializing = true
  harness.provider!.onBeforeDragStart!({ operation: operation(), preventDefault: vi.fn() })
})

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.body.appendChild(document.createElement("div"))
  root = createRoot(host)
  sourceElement = document.body.appendChild(document.createElement("button"))
  manager = {
    plugins: [], monitor: { addEventListener: vi.fn(() => () => {}) }, actions: { stop: vi.fn() },
    dragOperation: { controller: new AbortController(), status: { initializing: false, dragging: false },
      source: { data: { kind: "session", projectId: "p1", id: "root" }, element: sourceElement } },
  }
  harness.manager = manager
  const project = { id: "p1", status: "active", revision: 1, sidebar: { sections: [{ id: "custom", name: "Custom" }], session_sections: {}, hidden_legacy: false } } as unknown as ProjectManifest
  props = { projects: { p1: project }, chats: [{ id: "root", config: { projectId: "p1" } }] as ChatItem[], busy: new Set(),
    preferences: { version: 1, projects: { p1: { sections: project.sidebar!.sections, sessionSections: {}, hiddenLegacy: false } } },
    scopeKey: "session-a", onMoveSession: vi.fn(async () => false), onMoveSection: vi.fn(), children: () => null }
  useAppStore.setState({ projects: props.projects })
  render()
})
afterEach(() => { act(() => root.unmount()); host.remove(); sourceElement.remove() })

it("cancels navigation during synchronous initialization before delayed drag-start notification", () => {
  pickup()
  props = { ...props, scopeKey: "session-b" }
  render()
  expect(manager.actions.stop).toHaveBeenCalledWith({ canceled: true })
  act(() => harness.provider!.onDragEnd!({ operation: operation(), canceled: false }))
  expect(props.onMoveSession).not.toHaveBeenCalled()
})

it("cancels an already confirmed revision change while a gesture is held", () => {
  pickup()
  props = { ...props, projects: { p1: { ...props.projects.p1, revision: 2 } } }
  useAppStore.setState({ projects: props.projects })
  render()
  expect(manager.actions.stop).toHaveBeenCalledWith({ canceled: true })
  act(() => harness.provider!.onDragEnd!({ operation: operation(), canceled: false }))
  expect(props.onMoveSession).not.toHaveBeenCalled()
})

it.each(["resize", "blur", "contextmenu"])("cancels %s before a default end can commit a pending move", (event) => {
  pickup()
  act(() => (event === "contextmenu" ? document : window).dispatchEvent(new Event(event)))
  expect(manager.actions.stop).toHaveBeenCalledWith({ canceled: true })
  act(() => harness.provider!.onDragEnd!({ operation: operation(), canceled: false }))
  expect(props.onMoveSession).not.toHaveBeenCalled()
})

it("cancels when Settings makes the source ancestry inert without opening a dialog", async () => {
  pickup()
  await act(async () => sourceElement.parentElement!.setAttribute("inert", ""))
  expect(manager.actions.stop).toHaveBeenCalledWith({ canceled: true })
  sourceElement.parentElement!.removeAttribute("inert")
  act(() => harness.provider!.onDragEnd!({ operation: operation(), canceled: false }))
  expect(props.onMoveSession).not.toHaveBeenCalled()
})

it("commits one valid completed gesture and ignores an explicitly cancelled one", () => {
  pickup()
  act(() => harness.provider!.onDragEnd!({ operation: operation(), canceled: false }))
  expect(props.onMoveSession).toHaveBeenCalledExactlyOnceWith({ kind: "session", projectId: "p1", id: "root", revision: 1 }, { projectId: "p1", sectionId: "custom" }, false)
  pickup()
  act(() => harness.provider!.onDragEnd!({ operation: operation(), canceled: true }))
  expect(props.onMoveSession).toHaveBeenCalledTimes(1)
})
