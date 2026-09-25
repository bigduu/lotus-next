import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { applyActorTopologySnapshot, emptyActorTopology, type ActorTopologyRow, type ActorTopologyState } from "@/services/chat/actorTopology"
import { ActorTree, type ActorTreeProps } from "./ActorTree"

const roots: Root[] = []
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeAll(() => { reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true })
afterAll(() => { Reflect.deleteProperty(reactActEnvironment, "IS_REACT_ACT_ENVIRONMENT") })
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.replaceChildren()
})

function row(actorId: string, parentActorId: string | null, overrides: Partial<ActorTopologyRow> = {}): ActorTopologyRow {
  return {
    actorId,
    rootActorId: "root",
    parentActorId,
    title: actorId,
    role: null,
    lifecycle: "running",
    placement: "local",
    health: "healthy",
    queuedCount: 0,
    waitingForCount: 0,
    pendingRequestCount: 0,
    activationAttempt: 1,
    sequence: 1,
    ...overrides,
  }
}

function snapshot(actors: ActorTopologyRow[], revision = 1, previous = emptyActorTopology("root")): ActorTopologyState {
  return applyActorTopologySnapshot(previous, { rootActorId: "root", revision, actors })
}

function renderTree(props: Partial<ActorTreeProps> = {}) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  const initial: ActorTreeProps = {
    topology: snapshot([row("root", null)]),
    selectedActorId: null,
    onSelectActor: vi.fn(),
    ...props,
  }
  const rerender = (next: Partial<ActorTreeProps>) => {
    act(() => root.render(<ActorTree {...initial} {...next} />))
  }
  rerender({})
  return { container, rerender, props: initial }
}

function treeItem(container: HTMLElement, actorId: string): HTMLElement | null {
  return [...container.querySelectorAll<HTMLElement>('[role="treeitem"]')]
    .find((item) => item.dataset.actorId === actorId) ?? null
}

function key(container: HTMLElement, value: string) {
  const tree = container.querySelector<HTMLElement>('[role="tree"]')!
  act(() => tree.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true })))
}

describe("ActorTree", () => {
  it("expands a depth-four hierarchy with tree keyboard semantics and retains controlled selection after a snapshot", () => {
    const actors = [row("root", null), row("a", "root"), row("b", "a"), row("c", "b")]
    const first = snapshot(actors)
    const onSelectActor = vi.fn()
    const { container, rerender } = renderTree({ topology: first, selectedActorId: "c", onSelectActor })
    const tree = container.querySelector<HTMLElement>('[role="tree"]')!
    expect(tree.getAttribute("aria-label")).toBe("代理会话结构")
    expect(treeItem(container, "a")?.getAttribute("aria-level")).toBe("2")
    expect(treeItem(container, "a")?.getAttribute("aria-expanded")).toBe("false")
    expect(treeItem(container, "b")).toBeNull()

    act(() => treeItem(container, "a")?.querySelector<HTMLElement>("[data-actor-toggle]")?.click())
    expect(treeItem(container, "b")?.getAttribute("aria-level")).toBe("3")
    act(() => treeItem(container, "b")?.querySelector<HTMLElement>("[data-actor-toggle]")?.click())
    expect(treeItem(container, "c")?.getAttribute("aria-level")).toBe("4")
    expect(treeItem(container, "c")?.getAttribute("aria-selected")).toBe("true")
    expect(onSelectActor).not.toHaveBeenCalled()

    const second = snapshot(actors.map((actor) => ({ ...actor, sequence: 2 })), 2, first)
    rerender({ topology: second, selectedActorId: "c" })
    expect(treeItem(container, "c")?.getAttribute("aria-selected")).toBe("true")
    expect(treeItem(container, "b")?.getAttribute("aria-expanded")).toBe("true")

    key(container, "Home")
    key(container, "ArrowDown")
    key(container, "ArrowRight")
    key(container, "ArrowDown")
    key(container, "ArrowDown")
    key(container, "Enter")
    expect(onSelectActor).toHaveBeenCalledWith("c")
    key(container, "ArrowLeft")
    expect(tree.getAttribute("aria-activedescendant")).toBe(treeItem(container, "b")?.id)
  })

  it("keeps a 129-child tree to a bounded mounted window and preserves sibling metadata", () => {
    const actors = [
      row("root", null),
      ...Array.from({ length: 129 }, (_, index) => row(`child-${index}`, "root")),
    ]
    const topology = snapshot(actors)
    const { container } = renderTree({ topology })
    const virtual = container.querySelector<HTMLElement>("[data-actor-tree-virtual]")!
    const mounted = virtual.querySelectorAll('[role="treeitem"]')
    expect(mounted.length).toBeGreaterThan(0)
    expect(mounted.length).toBeLessThan(30)
    expect(Number.parseFloat(virtual.style.height)).toBe(130 * 64)
    expect(treeItem(container, "child-0")?.getAttribute("aria-posinset")).toBe("1")
    expect(treeItem(container, "child-0")?.getAttribute("aria-setsize")).toBe("129")
    expect(virtual.textContent).not.toContain("child-128")
  })

  it("reveals a newly selected descendant without loading its history", () => {
    const topology = snapshot([row("root", null), row("a", "root"), row("b", "a")])
    const onSelectActor = vi.fn()
    const { container, rerender } = renderTree({ topology, onSelectActor })
    expect(treeItem(container, "b")).toBeNull()

    rerender({ selectedActorId: "b" })
    expect(treeItem(container, "a")?.getAttribute("aria-expanded")).toBe("true")
    expect(treeItem(container, "b")?.getAttribute("aria-selected")).toBe("true")
    expect(onSelectActor).not.toHaveBeenCalled()
  })

  it("shows public lifecycle, placement, health, wait and unread states without transcript bodies", () => {
    const secret = "private transcript and tool body"
    const topology = snapshot([
      row("root", null, { title: "协调代理", role: "orchestrator", lifecycle: "running" }),
      { ...row("remote", "root", {
        title: "远端评审", role: "reviewer", lifecycle: "suspended", placement: "remote",
        health: "blocked_needs_input", queuedCount: 2, waitingForCount: 3, pendingRequestCount: 1,
      }), transcript: secret, toolBody: secret } as ActorTopologyRow,
      row("failed", "root", { lifecycle: "failed", placement: "container", health: "failed" }),
    ])
    const { container } = renderTree({ topology, unreadActorIds: new Set(["remote"]) })
    expect([...container.querySelectorAll<HTMLElement>('[role="treeitem"]')].map((item) => item.getAttribute("aria-label")))
      .toMatchInlineSnapshot(`
        [
          "协调代理，orchestrator，运行中，本机，正常",
          "远端评审，reviewer，已暂停，远端，等待输入，排队 2，等待 3，请求 1，有未读消息",
          "failed，代理，失败，容器，异常",
        ]
      `)
    expect(container.textContent).not.toContain(secret)
    expect(container.innerHTML).not.toContain(secret)
  })

  it("shows empty, stale and retry states without requesting child history", () => {
    const onRetry = vi.fn()
    const onSelectActor = vi.fn()
    const { container, rerender } = renderTree({
      topology: emptyActorTopology("root"), error: "结构加载失败", onRetry, onSelectActor,
    })
    expect(container.textContent).toContain("正在载入代理结构")
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("结构加载失败")
    act(() => container.querySelector<HTMLButtonElement>("button")?.click())
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onSelectActor).not.toHaveBeenCalled()

    const ready = snapshot([row("root", null)])
    rerender({ topology: ready, error: null })
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.querySelector('[role="tree"]')).not.toBeNull()
  })
})
