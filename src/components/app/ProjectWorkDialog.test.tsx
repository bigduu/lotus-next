import { act, useState, type ComponentProps } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { changeLocale } from "@shared/i18n"
import { uiText } from "@shared/i18n/ui"
import type { ProjectManifest } from "@services/project"
import { ProjectWorkDialog } from "./ProjectWorkDialog"

type Props = ComponentProps<typeof ProjectWorkDialog>
type Loader = NonNullable<Props["loadBoard"]>
type Module = Awaited<ReturnType<Loader>>
type BoardProps = ComponentProps<Module["ProjectWorkBoard"]>
const roots: ReturnType<typeof createRoot>[] = []
const observed: BoardProps[] = []
const project = (id = "A", revision = 1) => ({ id, name: `Project ${id}`, revision,
  resource_revision: 1, status: "active", workspace_bindings: [] }) as unknown as ProjectManifest
const Loaded: Module["ProjectWorkBoard"] = (props) => {
  const [draft, setDraft] = useState(`draft-${props.project.id}`)
  observed.push(props)
  return <div data-testid="loaded-board" data-project={props.project.id}>
    <input aria-label="board draft" value={draft} onChange={(event) => setDraft(event.target.value)} />
  </div>
}
const pending = () => {
  let resolve!: (module: Module) => void
  const load = vi.fn(() => new Promise<Module>((done) => { resolve = done }))
  return { load, resolve: () => resolve({ ProjectWorkBoard: Loaded }) }
}
function mount(loadBoard: Loader) {
  const host = document.body.appendChild(document.createElement("div")), root = createRoot(host)
  roots.push(root)
  const onClose = vi.fn()
  return { host, onClose, render: async (props: Partial<Props> = {}) => {
    await act(async () => root.render(<><input aria-label="conversation draft" defaultValue="conversation" />
      <ProjectWorkDialog project={project()} onClose={onClose} loadBoard={loadBoard} {...props} />
    </>))
  } }
}
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!
const closeButton = () => [...dialog().querySelectorAll("button")].find((button) => button.textContent === uiText("close_3fd47edc"))!
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  await changeLocale("en-US")
  observed.length = 0
})
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

it("keeps a closed dialog from loading Board code", async () => {
  const load = vi.fn<Loader>().mockResolvedValue({ ProjectWorkBoard: Loaded })
  const view = mount(load)
  await view.render({ project: null })
  expect(load).not.toHaveBeenCalled()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(view.host.querySelector("input")?.value).toBe("conversation")
})

it.each(["close", "Escape"])("keeps %s available during loading and never mounts a late result after close", async (method) => {
  const load = pending(), view = mount(load.load)
  await view.render({ metadataError: "metadata unavailable" })
  expect(dialog().textContent).toContain("Project A")
  expect(dialog().textContent).toContain("metadata unavailable")
  expect(dialog().querySelector('[role="status"]')?.textContent).toBe(uiText("project_work_loading"))
  expect(load.load).toHaveBeenCalledOnce()
  await act(async () => {
    if (method === "close") closeButton().click()
    else dialog().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
  })
  expect(view.onClose).toHaveBeenCalledOnce()
  await view.render({ project: null })
  await act(async () => load.resolve())
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(observed).toHaveLength(0)
})

it("uses the latest project, controls and access callback when the deferred code arrives", async () => {
  const load = pending(), view = mount(load.load), first = vi.fn(), latest = vi.fn()
  await view.render({ onOpenSession: first })
  const draft = view.host.querySelector("input")!
  draft.value = "keep my conversation"
  const controls = {}
  await view.render({ project: project("B", 4), controls, onOpenSession: latest })
  expect(dialog().textContent).toContain("Project B")
  await act(async () => load.resolve())
  expect(load.load).toHaveBeenCalledOnce()
  expect(observed.every((props) => props.project.id === "B")).toBe(true)
  expect(observed.at(-1)).toMatchObject({ project: { id: "B", revision: 4 }, controls, onOpenSession: latest })
  expect(first).not.toHaveBeenCalled()
  expect(latest).not.toHaveBeenCalled()
  expect(view.host.querySelector("input")).toBe(draft)
  expect(draft.value).toBe("keep my conversation")
})

it("retains a loaded Board draft through metadata updates and resets it only for another project or close", async () => {
  const load = vi.fn<Loader>().mockResolvedValue({ ProjectWorkBoard: Loaded }), view = mount(load)
  await view.render()
  const draft = document.querySelector<HTMLInputElement>('[aria-label="board draft"]')!
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
  await act(async () => { setter.call(draft, "edited planning draft"); draft.dispatchEvent(new Event("input", { bubbles: true })) })
  await view.render({ project: project("A", 2) })
  expect(document.querySelector('[aria-label="board draft"]')).toBe(draft)
  expect(draft.value).toBe("edited planning draft")
  await view.render({ project: project("B") })
  expect(document.querySelector<HTMLInputElement>('[aria-label="board draft"]')?.value).toBe("draft-B")
  await view.render({ project: null })
  await view.render({ project: project("A") })
  expect(document.querySelector<HTMLInputElement>('[aria-label="board draft"]')?.value).toBe("draft-A")
  expect(load).toHaveBeenCalledOnce()
})

it("contains a loading failure inside the closeable dialog and retries only on explicit request", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {})
  const load = vi.fn<Loader>().mockRejectedValueOnce(new Error("controlled load failure"))
    .mockResolvedValueOnce({ ProjectWorkBoard: Loaded })
  const view = mount(load)
  await view.render()
  expect(dialog().querySelector('[role="alert"]')?.textContent).toContain(uiText("work_load_failed"))
  expect(closeButton()).toBeDefined()
  expect(load).toHaveBeenCalledOnce()
  const draft = view.host.querySelector("input")!
  draft.value = "keep after failure"
  await act(async () => [...dialog().querySelectorAll("button")].find((button) => button.textContent === uiText("retry_b8784c8d"))!.click())
  expect(load).toHaveBeenCalledTimes(2)
  expect(dialog().querySelector('[role="alert"]')).toBeNull()
  expect(dialog().querySelector('[data-testid="loaded-board"]')).not.toBeNull()
  expect(view.host.querySelector("input")).toBe(draft)
  expect(draft.value).toBe("keep after failure")
})
