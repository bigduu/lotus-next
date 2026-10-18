import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { emptyWorkbenchState, readWorkbenchState, useWorkbenchState, workbenchStorageKey } from "./useWorkbenchState"

const runtime = vi.hoisted(() => ({ backend: "https://one.example/api/v1" }))
vi.mock("@services/api", () => ({ getBackendStorageScope: () => runtime.backend }))

let root: Root
let container: HTMLDivElement
let latest: ReturnType<typeof useWorkbenchState>
function Harness({ session }: { session: string | null }) {
  latest = useWorkbenchState(session)
  return <div>{JSON.stringify(latest.state)}</div>
}
const render = (session: string | null) => act(() => { root.render(<Harness session={session} />) })
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear()
  runtime.backend = "https://one.example/api/v1"
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks() })

describe("session workbench persistence", () => {
  it("restores open tabs, order, active tab and resource descriptors after remount", () => {
    render("a")
    act(() => {
      latest.setField("open", true)
      latest.setField("tools", ["session", "review"])
      latest.setField("tab", "review")
      latest.setField("order", ["browser:page-1", "tool:session", "tool:review"])
      latest.setField("secondSid", "child-2")
      latest.setField("reviewTarget", "src/App.tsx")
      latest.setField("browserActiveId", "page-1")
      latest.setField("browserPresent", true)
    })
    const expected = latest.state
    act(() => root.unmount())
    root = createRoot(container)
    render("a")
    expect(latest.state).toEqual({ ...expected, tools: ["session", "review"] })
    expect(localStorage.getItem(latest.scope!)).not.toMatch(/password|cookie|token|pageContent/)
  })

  it("isolates sessions/backends and ignores stale asynchronous updates", () => {
    render("same-id")
    act(() => { latest.setField("tools", ["inspector"]); latest.setField("tab", "inspector") })
    const stale = latest.setField
    render("other")
    expect(latest.state).toEqual(emptyWorkbenchState())
    act(() => stale("tab", "review"))
    expect(latest.state.tab).toBeNull()
    act(() => latest.setField("tools", ["session"]))
    render("same-id")
    expect(latest.state.tools).toEqual(["inspector"])
    runtime.backend = "https://two.example/api/v1"
    render("same-id")
    expect(latest.state).toEqual(emptyWorkbenchState())
    runtime.backend = "https://one.example/api/v1"
    render("other")
    expect(latest.state.tools).toEqual(["session"])
  })

  it("persists close, reorder and active selection changes", () => {
    render("a")
    act(() => {
      latest.setField("tools", ["review", "inspector"])
      latest.setField("order", ["tool:review", "tool:inspector"])
      latest.setField("tab", "review")
    })
    act(() => {
      latest.setField("order", (order) => [...order].reverse())
      latest.setField("tools", (tools) => tools.filter((tool) => tool !== "review"))
      latest.setField("order", (order) => order.filter((id) => id !== "tool:review"))
      latest.setField("tab", "inspector")
      latest.setField("open", false)
    })
    expect(readWorkbenchState(latest.scope)).toMatchObject({ tools: ["inspector"], order: ["tool:inspector"], tab: "inspector", open: false })
  })

  it("rejects malformed and future snapshots, and validates descriptors", () => {
    const key = workbenchStorageKey(runtime.backend, "a")!
    for (const value of ["broken", "null", JSON.stringify({ version: 2, state: { open: true } })]) {
      localStorage.setItem(key, value)
      expect(readWorkbenchState(key)).toEqual(emptyWorkbenchState())
    }
    localStorage.setItem(key, JSON.stringify({ version: 1, state: {
      open: "yes", tools: ["shell", "review", "review"], tab: "shell", order: ["tool:shell", "tool:review", "tool:review", 5], secondSid: {}, browserActiveId: 8,
    } }))
    expect(readWorkbenchState(key)).toMatchObject({ open: false, tools: ["review"], tab: null, order: ["tool:review"], secondSid: null, browserActiveId: null })
  })

  it("tolerates unavailable storage and does not persist a draft session", () => {
    const get = vi.spyOn(localStorage, "getItem").mockImplementation(() => { throw new Error("blocked") })
    const set = vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("full") })
    render("a")
    act(() => latest.setField("open", true))
    expect(latest.state.open).toBe(true)
    expect(set).toHaveBeenCalled()
    act(() => latest.openToolForSession("b", "work"))
    render("b")
    expect(latest.state).toMatchObject({ open: true, tab: "work" })
    get.mockRestore(); set.mockRestore()
    render(null)
    act(() => latest.setField("open", true))
    expect(localStorage.length).toBe(0)
  })

  it("applies navigation tool intents to their destination without changing the outgoing session", () => {
    render("a")
    act(() => { latest.setField("tools", ["review"]); latest.setField("tab", "review") })
    act(() => latest.openToolForSession("supervisor", "work"))
    expect(latest.state.tools).toEqual(["review"])
    render("supervisor")
    expect(latest.state).toMatchObject({ open: true, tab: "work", tools: ["work"] })
    act(() => latest.openToolForSession("a", "inspector"))
    render("a")
    expect(latest.state).toMatchObject({ open: true, tab: "inspector", tools: ["review", "inspector"] })
    render("supervisor")
    expect(latest.state.tools).toEqual(["work"])
  })

  it("merges same-session navigation with preceding updates in the same event", () => {
    render("a")
    act(() => latest.setField("secondSid", "b"))
    act(() => {
      latest.setField("secondSid", null)
      latest.openToolForSession("a", "inspector")
    })
    expect(latest.state).toMatchObject({ secondSid: null, open: true, tab: "inspector", tools: ["inspector"] })
  })

  it("strips credentials and URL query/fragment from backend identity", () => {
    expect(workbenchStorageKey("https://user:secret@example.com/api/v1?token=secret#secret", "a"))
      .toBe(workbenchStorageKey("https://example.com/api/v1", "a"))
  })
})
