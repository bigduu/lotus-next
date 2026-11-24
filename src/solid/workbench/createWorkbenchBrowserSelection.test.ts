import { createRoot, createSignal, flush } from "solid-js"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { emptyWorkbenchState, readWorkbenchState, workbenchStorageKey, writeWorkbenchState, type WorkbenchState } from "@/lib/workbenchState"
import type { BrowserState } from "@services/browser/types"

import { createWorkbenchBrowserSelection } from "./createWorkbenchBrowserSelection"
import { createWorkbenchState } from "./createWorkbenchState"

const endpoint = "https://one.example/api/v1"
const initialSession = "session-a"
const storageKey = (session: string) => workbenchStorageKey(endpoint, session)!
const activateTab = vi.fn<(id: string) => Promise<BrowserState | null>>()
const browser = (active = "b", ids = ["a", "b"]): BrowserState => ({
  page_epoch: 1, frame_seq: 1, url: "", title: "", viewport: { width: 640, height: 480 },
  can_go_back: false, can_go_forward: false, active_tab_id: active,
  tabs: ids.map((id) => ({ tab_id: id, url: "", title: id, active: id === active })),
})
const blocked = () => ({ ...browser(), pending_dialog: { dialog_id: "dialog" } as BrowserState["pending_dialog"] })
let dispose: (() => void) | undefined
let workbench: ReturnType<typeof createWorkbenchState>
let select: (session: string) => void
let observe: (value: BrowserState | null) => void
let selectionVersion: number

function mount(state: Partial<WorkbenchState> = {}, intent?: "entry" | "link") {
  writeWorkbenchState(storageKey(initialSession), {
    ...emptyWorkbenchState(), open: true, tab: "browser", browserPresent: true, browserActiveId: "a", ...state,
  })
  createRoot((cleanup) => {
    dispose = cleanup
    const [session, setSession] = createSignal(initialSession)
    const [snapshot, setSnapshot] = createSignal<BrowserState | null>(null)
    select = setSession
    observe = setSnapshot
    workbench = createWorkbenchState(session, () => endpoint)
    createWorkbenchBrowserSelection({
      workbench, state: snapshot, tools: () => workbench.state().tools, selectionVersion: () => selectionVersion,
      activateTab, entryOpen: () => intent === "entry", linkPending: () => intent === "link",
    })
  })
  flush()
}

async function render(state: BrowserState | null, session = initialSession) {
  select(session)
  observe(state)
  flush()
  await Promise.resolve()
  flush()
}

beforeEach(() => { localStorage.clear(); activateTab.mockReset(); selectionVersion = 0 })
afterEach(() => { dispose?.(); dispose = undefined; localStorage.clear() })

it("preserves a saved tab while a dialog blocks activation, then restores after dismissal", async () => {
  mount()
  await render(blocked())
  expect(activateTab).not.toHaveBeenCalled()
  expect(workbench.state().browserActiveId).toBe("a")
  activateTab.mockResolvedValue(browser("a"))
  await render(browser())
  expect(activateTab).toHaveBeenCalledExactlyOnceWith("a")
  expect(readWorkbenchState(storageKey(initialSession)).browserActiveId).toBe("a")
})

it("keeps the saved ID after a failed activation and retries only on fresh server state", async () => {
  mount()
  activateTab.mockResolvedValueOnce(null).mockResolvedValueOnce(browser("a"))
  const first = browser()
  await render(first)
  await render(first)
  expect(activateTab).toHaveBeenCalledTimes(1)
  expect(workbench.state().browserActiveId).toBe("a")
  await render(browser())
  expect(activateTab).toHaveBeenCalledTimes(2)
  expect(workbench.state().browserActiveId).toBe("a")
})

it("ignores the previous activation response after navigation", async () => {
  mount()
  let resolve!: (value: BrowserState) => void
  activateTab.mockReturnValue(new Promise((done) => { resolve = done }))
  await render(browser())
  await render(null, "session-b")
  resolve(browser("b"))
  await Promise.resolve()
  flush()
  expect(workbench.state().browserActiveId).toBeNull()
  expect(readWorkbenchState(storageKey(initialSession)).browserActiveId).toBe("a")
})

it("gives a newer explicit selection priority over dialog-blocked restoration", async () => {
  mount()
  await render(blocked())
  selectionVersion += 1
  await render(browser())
  expect(activateTab).not.toHaveBeenCalled()
  expect(workbench.state().browserActiveId).toBe("b")
})

it("restores server tab order, dropping departed pages and retaining saved tool order", async () => {
  mount({ tools: ["inspector", "review"], order: ["tool:review", "browser:a", "tool:inspector", "browser:b"] })
  await render(browser("b", ["b", "c"]))
  expect(workbench.state()).toMatchObject({ tab: "browser", browserPresent: true, browserActiveId: "b",
    order: ["tool:review", "tool:inspector", "browser:b", "browser:c"] })
  expect(activateTab).not.toHaveBeenCalled()
})

it("falls back to the last visible tool when the remembered browser has explicitly lost all tabs", async () => {
  mount({ tools: ["inspector", "review"], order: ["tool:review", "browser:a", "tool:inspector"] })
  await render(browser("", []))
  expect(workbench.state()).toMatchObject({ tab: "inspector", browserPresent: false, browserActiveId: null,
    order: ["tool:review", "tool:inspector"] })
  expect(activateTab).not.toHaveBeenCalled()
})

it("falls back to the launcher when a previously nonempty browser has no remaining tool", async () => {
  mount()
  await render(browser("", []))
  expect(workbench.state().tab).toBeNull()
  expect(activateTab).not.toHaveBeenCalled()
})

it.each([undefined, "entry", "link"] as const)("preserves an explicit empty recovery surface %s", async (intent) => {
  mount({ browserPresent: intent !== undefined }, intent)
  await render(browser("", []))
  expect(workbench.state().tab).toBe("browser")
  expect(activateTab).not.toHaveBeenCalled()
})

it("keeps a live browser dialog reachable even if the server lists no pages", async () => {
  mount()
  await render({ ...blocked(), tabs: [], active_tab_id: "" })
  expect(workbench.state().tab).toBe("browser")
  expect(activateTab).not.toHaveBeenCalled()
})

it("keeps the active browser when pages disappear after this visit has restored", async () => {
  mount()
  await render(browser("a"))
  await render(browser("", []))
  expect(workbench.state().tab).toBe("browser")
})
