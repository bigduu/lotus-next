import { createRoot, createSignal, flush } from "solid-js"
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"

import { emptyWorkbenchState, readWorkbenchState, workbenchStorageKey } from "@/lib/workbenchState"

import { createWorkbenchState } from "./createWorkbenchState"

const endpoint = "https://one.example/api/v1"
let dispose: (() => void) | undefined
let latest: ReturnType<typeof createWorkbenchState>
let setSession: (id: string | null) => void
let setBackend: (scope: string) => void

function applyChanges(change: () => void) {
  change()
  flush()
}

function selectSession(session: string | null) {
  applyChanges(() => setSession(session))
}

function mount(session: string | null = null) {
  dispose?.()
  createRoot((cleanup) => {
    dispose = cleanup
    const [sessionId, changeSession] = createSignal(session)
    const [backend, changeBackend] = createSignal(endpoint)
    setSession = changeSession
    setBackend = changeBackend
    latest = createWorkbenchState(sessionId, backend)
  })
  flush()
}

beforeEach(() => { localStorage.clear(); mount() })
afterEach(() => { dispose?.(); dispose = undefined; vi.restoreAllMocks() })

describe("session workbench persistence", () => {
  it("restores open tabs, order, active tab and resource descriptors after remount", () => {
    selectSession("a")
    applyChanges(() => {
      latest.capture().setField("open", true)
      latest.capture().setField("tools", ["subagents", "review", "side-chat"])
      latest.capture().setField("tab", "side-chat")
      latest.capture().setField("order", ["browser:page-1", "tool:subagents", "tool:review", "tool:side-chat"])
      latest.capture().setField("subagents", { childId: "child-2", view: "messages" })
      latest.capture().setField("reviewTarget", "src/App.tsx")
      latest.capture().setField("browserActiveId", "page-1")
      latest.capture().setField("browserPresent", true)
    })
    const expected = latest.state()
    mount("a")
    expect(latest.state()).toEqual({ ...expected, tools: ["subagents", "review", "side-chat"] })
    expect(localStorage.getItem(latest.key()!)).not.toMatch(/password|cookie|token|pageContent/)
  })

  it("isolates sessions/backends and ignores stale asynchronous updates", () => {
    selectSession("same-id")
    applyChanges(() => { latest.capture().setField("tools", ["inspector"]); latest.capture().setField("tab", "inspector") })
    const stale = latest.capture().setField
    selectSession("other")
    expect(latest.state()).toEqual(emptyWorkbenchState())
    applyChanges(() => stale("tab", "review"))
    expect(latest.state().tab).toBeNull()
    applyChanges(() => latest.capture().setField("tools", ["subagents"]))
    selectSession("same-id")
    expect(latest.state().tools).toEqual(["inspector"])
    setBackend("https://two.example/api/v1")
    selectSession("same-id")
    expect(latest.state()).toEqual(emptyWorkbenchState())
    setBackend(endpoint)
    selectSession("other")
    expect(latest.state().tools).toEqual(["subagents"])
  })

  it("keeps in-memory per-session state and rejects a setter from an earlier visit to the same session", () => {
    vi.spyOn(localStorage, "getItem").mockImplementation(() => { throw new Error("blocked") })
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("blocked") })
    selectSession("a")
    applyChanges(() => latest.capture().setField("subagents", {
      childId: "child-a", view: "messages", expandedActorIds: ["a", "branch-a"],
    }))
    const stale = latest.capture().setField
    selectSession("b")
    applyChanges(() => latest.capture().setField("tools", ["review"]))
    selectSession("a")
    applyChanges(() => stale("subagents", { childId: "stale", view: "messages" }))
    expect(latest.state().subagents).toEqual({
      childId: "child-a", view: "messages", expandedActorIds: ["a", "branch-a"],
    })
    selectSession("b")
    expect(latest.state().tools).toEqual(["review"])
  })

  it("persists close, reorder and active selection changes", () => {
    selectSession("a")
    applyChanges(() => {
      latest.capture().setField("tools", ["review", "inspector"])
      latest.capture().setField("order", ["tool:review", "tool:inspector"])
      latest.capture().setField("tab", "review")
    })
    applyChanges(() => {
      latest.capture().setField("order", (order) => [...order].reverse())
      latest.capture().setField("tools", (tools) => tools.filter((tool) => tool !== "review"))
      latest.capture().setField("order", (order) => order.filter((id) => id !== "tool:review"))
      latest.capture().setField("tab", "inspector")
      latest.capture().setField("open", false)
    })
    expect(readWorkbenchState(latest.key())).toMatchObject({ tools: ["inspector"], order: ["tool:inspector"], tab: "inspector", open: false })
  })

  it("rejects malformed and future snapshots, and validates descriptors", () => {
    const key = workbenchStorageKey(endpoint, "a")!
    for (const value of ["broken", "null", JSON.stringify({ version: 99, state: { open: true } })]) {
      localStorage.setItem(key, value)
      expect(readWorkbenchState(key)).toEqual(emptyWorkbenchState())
    }
    localStorage.setItem(key, JSON.stringify({ version: 1, state: {
      open: "yes", tools: ["shell", "review", "review"], tab: "shell", order: ["tool:shell", "tool:review", "tool:review", 5], secondSid: {}, browserActiveId: 8,
    } }))
    expect(readWorkbenchState(key)).toMatchObject({ open: false, tools: ["review"], tab: null, order: ["tool:review"], subagents: { childId: null, view: "tree" }, browserActiveId: null })
  })

  it("migrates a legacy side selection to a candidate in the Subagents tab", () => {
    const key = workbenchStorageKey(endpoint, "a")!
    localStorage.setItem(key, JSON.stringify({ version: 1, state: {
      open: true, tools: ["review", "session"], tab: "session",
      order: ["tool:session", "tool:review"], secondSid: "legacy-target",
    } }))
    selectSession("a")
    expect(latest.state()).toMatchObject({
      open: true, tab: "subagents", tools: ["review", "subagents"],
      order: ["tool:subagents", "tool:review"],
      subagents: { childId: "legacy-target", view: "messages" },
    })
    expect(JSON.parse(localStorage.getItem(key)!).version).toBe(2)
  })

  it("tolerates unavailable storage and does not persist a draft session", () => {
    const get = vi.spyOn(localStorage, "getItem").mockImplementation(() => { throw new Error("blocked") })
    const set = vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("full") })
    selectSession("a")
    applyChanges(() => latest.capture().setField("open", true))
    expect(latest.state().open).toBe(true)
    expect(set).toHaveBeenCalled()
    applyChanges(() => latest.capture().openToolForSession("b", "work"))
    selectSession("b")
    expect(latest.state()).toMatchObject({ open: true, tab: "work" })
    get.mockRestore(); set.mockRestore()
    selectSession(null)
    applyChanges(() => latest.capture().setField("open", true))
    expect(localStorage.length).toBe(0)
  })

  it("applies navigation tool intents to their destination without changing the outgoing session", () => {
    selectSession("a")
    applyChanges(() => { latest.capture().setField("tools", ["review"]); latest.capture().setField("tab", "review") })
    applyChanges(() => latest.capture().openToolForSession("supervisor", "work"))
    expect(latest.state().tools).toEqual(["review"])
    selectSession("supervisor")
    expect(latest.state()).toMatchObject({ open: true, tab: "work", tools: ["work"] })
    applyChanges(() => latest.capture().openToolForSession("a", "inspector"))
    selectSession("a")
    expect(latest.state()).toMatchObject({ open: true, tab: "inspector", tools: ["review", "inspector"] })
    selectSession("supervisor")
    expect(latest.state().tools).toEqual(["work"])
  })

  it("merges same-session navigation with preceding updates in the same event", () => {
    selectSession("a")
    applyChanges(() => latest.capture().setField("subagents", { childId: "b", view: "messages" }))
    applyChanges(() => {
      latest.capture().setField("subagents", { childId: null, view: "tree" })
      latest.capture().openToolForSession("a", "inspector")
    })
    expect(latest.state()).toMatchObject({ subagents: { childId: null, view: "tree" }, open: true, tab: "inspector", tools: ["inspector"] })
  })

  it("rejects current- and destination-session writes from a disposed owner", () => {
    selectSession("a")
    const previous = latest.capture()
    mount("a")
    applyChanges(() => {
      previous.setField("open", true)
      previous.openToolForSession("b", "work")
    })
    expect(latest.state()).toEqual(emptyWorkbenchState())
    expect(readWorkbenchState(workbenchStorageKey(endpoint, "b"))).toEqual(emptyWorkbenchState())
  })

  it("strips credentials and URL query/fragment from backend identity", () => {
    expect(workbenchStorageKey("https://user:secret@example.com/api/v1?token=secret#secret", "a"))
      .toBe(workbenchStorageKey("https://example.com/api/v1", "a"))
  })
})
