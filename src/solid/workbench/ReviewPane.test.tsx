import { render } from "@solidjs/web"
import { createSignal, flush } from "solid-js"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { groupSessionFileChanges } from "@/lib/sessionFileChanges"
import { ReviewPane } from "./ReviewPane"

vi.mock("@lucide/solid", () => {
  const Icon = () => <svg aria-hidden="true" />
  return { Columns2: Icon, FileDiff: Icon, Rows3: Icon, WrapText: Icon }
})

const observers = new Set<() => void>()
const disposers = new Set<() => void>()
const scrollToFile = vi.fn()
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView")
let width = 400

beforeEach(() => {
  width = 400
  HTMLElement.prototype.scrollIntoView = scrollToFile
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(performance.now()); return 1 })
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ width }) as DOMRect)
  vi.stubGlobal("ResizeObserver", class {
    constructor(private notify: () => void) { observers.add(notify) }
    observe() {}
    disconnect() { observers.delete(this.notify) }
  })
})

afterEach(() => {
  for (const dispose of disposers) dispose()
  disposers.clear()
  observers.clear()
  if (originalScroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScroll)
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView")
})

const workspace = "/workspace"
const grouped = groupSessionFileChanges([
  { id: "a-first", payload: { operation: "edit", file_path: `${workspace}/src/a.ts`, diff: {
    unified: "--- /workspace/src/a.ts\n+++ /workspace/src/a.ts\n@@ -1 +1,2 @@\n-old a\n+new a\n+more a",
  } } },
  { id: "b-first", payload: { operation: "edit", file_path: `${workspace}/src/b.ts`, diff: { unified: "+only b" } } },
  { id: "a-next", payload: { operation: "edit", file_path: `${workspace}/src/a.ts`, diff: { unified: "@@ -3 +3,2 @@\n+later a" } } },
])

function mount(groups = grouped, target?: string) {
  const host = document.body.appendChild(document.createElement("div"))
  const [file, selectFile] = createSignal(target)
  // Only geometry is simulated. The disclosure, buttons and diff rows are real.
  const dispose = render(() => <ReviewPane sessionId="review-session" groups={groups} workspace={workspace} targetFile={file()} />, host)
  disposers.add(() => { dispose(); host.remove() })
  flush()
  return {
    host,
    disclosures: () => [...host.querySelectorAll("details")],
    select(path: string) { selectFile(path); flush() },
  }
}

it("groups repeated changes, keeps the full path title and opens only the most recent file", () => {
  const { host, disclosures } = mount()
  const [older, latest] = disclosures()
  expect(disclosures()).toHaveLength(2)
  expect(older.querySelector("summary")?.textContent).toContain("src/b.ts")
  expect(older.open).toBe(false)
  expect(older.textContent).not.toContain("only b")
  expect(latest.querySelector("summary span[title]")?.getAttribute("title")).toBe("/workspace/src/a.ts")
  expect(latest.querySelector("summary")?.textContent).toContain("src/a.ts")
  expect(latest.querySelector("summary")?.textContent).toContain("2 次修改")
  expect(latest.querySelector("summary")?.textContent).toContain("+3")
  expect(latest.querySelector("summary")?.textContent).toContain("−1")
  expect(latest.open).toBe(true)
  expect(host.textContent).toContain("2 个文件")
  const patches = [...latest.querySelectorAll("section")]
  expect(patches.map((patch) => patch.getAttribute("aria-label"))).toEqual([
    "src/a.ts 第 1 次修改", "src/a.ts 第 2 次修改",
  ])
  expect(patches[0].textContent).toContain("old a")
  expect(patches[1].textContent).toContain("later a")
  expect(patches.every((patch) => !patch.textContent?.includes("/workspace/src/a.ts"))).toBe(true)
})

it("opens the file requested by a Review handoff and keeps other details unmounted", () => {
  const view = mount(grouped, "/workspace/src/b.ts")
  const [selected, recent] = view.disclosures()
  expect(selected.open).toBe(true)
  expect(selected.textContent).toContain("only b")
  expect(recent.open).toBe(false)
  expect(recent.querySelector("section")).toBeNull()
  view.select(grouped[1].id)
  expect(recent.open).toBe(true)
  expect(recent.textContent).toContain("later a")
  expect(scrollToFile).toHaveBeenCalledWith({ block: "start" })
})

it("uses unified diff in a narrow disclosure and enables comparison only at a usable width", () => {
  const { disclosures } = mount()
  const latest = disclosures()[1]
  const compare = () => [...latest.querySelectorAll("button")].find((button) => button.textContent === "对照")!
  expect(compare().disabled).toBe(true)
  expect(compare().title).toContain("展开面板")
  expect(latest.querySelector('[role="table"]')).not.toBeNull()

  width = 720
  for (const resize of observers) resize()
  flush()
  expect(compare().disabled).toBe(false)
  compare().click()
  flush()
  expect(latest.querySelector("table")).not.toBeNull()

  width = 400
  for (const resize of observers) resize()
  flush()
  expect(compare().disabled).toBe(true)
  expect(latest.querySelector("table")).toBeNull()
  expect(latest.querySelector('[role="table"]')).not.toBeNull()
})

it("shows no file disclosures when the session has no reviewed changes", () => {
  const view = mount([])
  expect(view.disclosures()).toHaveLength(0)
  expect(view.host.textContent).toContain("当前会话还没有可 Review 的文件变更。")
})
