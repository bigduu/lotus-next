import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { useWorkbenchBrowserSelection } from "./useWorkbenchBrowserSelection"
import type { BrowserState } from "@services/browser/types"

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
const activateTab = vi.fn<(id: string) => Promise<BrowserState | null>>()
const save = vi.fn()
const selectionVersion = { current: 0 }
const state = (active = "b"): BrowserState => ({ page_epoch: 1, frame_seq: 1, url: "", title: "",
  viewport: { width: 640, height: 480 }, can_go_back: false, can_go_forward: false,
  active_tab_id: active, tabs: ["a", "b"].map((id) => ({ tab_id: id, url: "", title: id, active: id === active })) })
function Harness({ value, scope = "session-a" }: { value: BrowserState | null; scope?: string }) {
  useWorkbenchBrowserSelection({ scope, state: value, savedId: "a", selectionVersion, activateTab, save })
  return null
}
const render = async (value: BrowserState | null, scope?: string) => { await act(async () => root.render(<Harness value={value} scope={scope} />)) }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host)
  activateTab.mockReset(); save.mockReset(); selectionVersion.current = 0
})
afterEach(() => { act(() => root.unmount()); host.remove() })
it("preserves the saved active tab while a dialog blocks restoration and restores after dismissal", async () => {
  const blocked = { ...state(), pending_dialog: { dialog_id: "dialog" } as BrowserState["pending_dialog"] }
  await render(blocked)
  expect(activateTab).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled()
  activateTab.mockResolvedValue(state("a"))
  await render(state())
  expect(activateTab).toHaveBeenCalledWith("a"); expect(save).toHaveBeenLastCalledWith("a")
})
it("does not overwrite the saved ID after a failed activation and retries on fresh state", async () => {
  activateTab.mockResolvedValueOnce(null).mockResolvedValueOnce(state("a"))
  const first = state()
  await render(first); await render(first)
  expect(activateTab).toHaveBeenCalledTimes(1); expect(save).not.toHaveBeenCalled()
  await render(state())
  expect(activateTab).toHaveBeenCalledTimes(2); expect(save).toHaveBeenCalledWith("a")
})
it("ignores an activation response after switching scopes", async () => {
  let resolve!: (value: BrowserState) => void
  activateTab.mockReturnValue(new Promise((done) => { resolve = done }))
  await render(state()); await render(null, "session-b")
  await act(async () => resolve(state("a")))
  expect(save).not.toHaveBeenCalled()
})
it("lets a newer explicit selection supersede blocked restoration", async () => {
  await render({ ...state(), pending_dialog: { dialog_id: "dialog" } as BrowserState["pending_dialog"] })
  selectionVersion.current += 1
  await render(state())
  expect(activateTab).not.toHaveBeenCalled(); expect(save).toHaveBeenCalledWith("b")
})
