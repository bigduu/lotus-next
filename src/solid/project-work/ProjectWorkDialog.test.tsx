import { createContext, createSignal, flush, Show, useContext } from "solid-js"
import { render, type ComponentProps, type JSX } from "@solidjs/web"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { changeLocale } from "@shared/i18n/runtime"
import { uiText } from "@shared/i18n/text"
import type { ProjectManifest } from "@services/project"
import { ProjectWorkDialog } from "./ProjectWorkDialog"

// The artifact test exercises real Kobalte closure, focus and chunk delivery.
vi.mock("../ui/responsive-dialog", () => {
  const ChangeOpen = createContext<(open: boolean) => void>()
  type Children = { children: JSX.Element }
  return {
    ResponsiveDialog: (props: Children & { open: boolean; onOpenChange: (open: boolean) => void }) =>
      <Show when={props.open}><ChangeOpen value={props.onOpenChange}>{props.children}</ChangeOpen></Show>,
    ResponsiveDialogContent: (props: Children & { ref?: (element: HTMLDivElement) => void }) => {
      const change = useContext(ChangeOpen)
      return <div role="dialog" ref={props.ref} onKeyDown={(event) => {
        if (event.key === "Escape") change(false)
      }}>
        {props.children}
        <button type="button" aria-label={uiText("close_3fd47edc")} onClick={() => change(false)} />
      </div>
    },
    ResponsiveDialogTitle: (props: Children) => <h2>{props.children}</h2>,
    ResponsiveDialogDescription: (props: Children) => <p>{props.children}</p>,
  }
})

type Props = ComponentProps<typeof ProjectWorkDialog>
type Loader = NonNullable<Props["loadBoard"]>
type Module = Awaited<ReturnType<Loader>>
type BoardProps = ComponentProps<Module["ProjectWorkBoard"]>
const disposers: Array<() => void> = []
const observed: BoardProps[] = []
const schedule = setTimeout
async function settle(action: () => unknown) {
  await action()
  await new Promise<void>((resolve) => schedule(resolve, 0))
  flush()
}
const project = (id = "A", revision = 1) => ({ id, name: `Project ${id}`, revision,
  resource_revision: 1, status: "active", workspace_bindings: [] }) as unknown as ProjectManifest
const Loaded: Module["ProjectWorkBoard"] = (props) => {
  const [draft, setDraft] = createSignal(`draft-${props.project.id}`)
  observed.push({ project: props.project, ownerAccess: props.ownerAccess, controls: props.controls, onOpenSession: props.onOpenSession })
  return <div data-testid="loaded-board" data-project={props.project.id}>
    <input aria-label="board draft" value={draft()} onInput={(event) => setDraft(event.currentTarget.value)} />
  </div>
}
const pending = () => {
  let resolve!: (module: Module) => void
  const load = vi.fn(() => new Promise<Module>((done) => { resolve = done }))
  return { load, resolve: () => resolve({ ProjectWorkBoard: Loaded }) }
}
function mount(loadBoard: Loader) {
  const host = document.body.appendChild(document.createElement("div"))
  const [current, setCurrent] = createSignal<Partial<Props>>()
  const onClose = vi.fn()
  const dispose = render(() => <><input aria-label="conversation draft" value="conversation" />
    <Show when={current()}>{(value) => <ProjectWorkDialog project={project()} ownerAccess onClose={onClose}
      loadBoard={loadBoard} {...value()} />}</Show>
  </>, host)
  disposers.push(() => { dispose(); host.remove() })
  return { host, onClose, render: (props: Partial<Props> = {}) => settle(() => setCurrent(props)) }
}
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!
const closeButton = () => dialog().querySelector<HTMLButtonElement>(`button[aria-label="${uiText("close_3fd47edc")}"]`)!
beforeEach(async () => {
  await changeLocale("en-US")
  observed.length = 0
})
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
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
  await settle(() => {
    if (method === "close") closeButton().click()
    else dialog().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
  })
  expect(view.onClose).toHaveBeenCalledOnce()
  await view.render({ project: null })
  await settle(() => load.resolve())
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
  await settle(() => load.resolve())
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
  await settle(() => { setter.call(draft, "edited planning draft"); draft.dispatchEvent(new Event("input", { bubbles: true })) })
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
  await settle(() => [...dialog().querySelectorAll("button")].find((button) => button.textContent === uiText("retry_b8784c8d"))!.click())
  expect(load).toHaveBeenCalledTimes(2)
  expect(dialog().querySelector('[role="alert"]')).toBeNull()
  expect(dialog().querySelector('[data-testid="loaded-board"]')).not.toBeNull()
  expect(view.host.querySelector("input")).toBe(draft)
  expect(draft.value).toBe("keep after failure")
})
