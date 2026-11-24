import { createRoot, createSignal, flush } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"

import { getWorkbenchMaxWidth, MIN_DOCKED_CHAT_WIDTH } from "../ui/resizable-layout"
import { createWorkbenchWidth } from "./createWorkbenchWidth"

const legacyKey = "lotus_next_inspector_w"
let dispose: (() => void) | undefined

function mount(saved: number | null = null) {
  dispose?.()
  return createRoot((cleanup) => {
    dispose = cleanup
    const [container, setContainer] = createSignal(1920)
    const [sidebar, setSidebar] = createSignal(288)
    const [preferred, setPreferred] = createSignal(saved)
    const width = createWorkbenchWidth(container, sidebar, preferred, setPreferred)
    return {
      ...width,
      layout(container: number, sidebar = 288) {
        setContainer(container)
        setSidebar(sidebar)
        flush()
      },
      prefer(saved: number) { setPreferred(saved); flush() },
      resize(widthPx: number) { width.setWidth(widthPx); flush() },
    }
  })
}

afterEach(() => { dispose?.(); dispose = undefined; localStorage.clear(); vi.restoreAllMocks() })

it.each([
  [1280, 420, 442], [1280, 288, 574], [1920, 288, 1214], [1920, 0, 1503], [2560, 420, 1722],
])("reserves chat space inside a %i px container with a %i px sidebar", (container, sidebar, expected) => {
  expect(getWorkbenchMaxWidth(container, sidebar)).toBe(expected)
  expect(container - sidebar - expected - (sidebar > 0 ? 2 : 1)).toBe(MIN_DOCKED_CHAT_WIDTH)
})

it("switches to an overlay when measured space cannot fit both columns", () => {
  const width = mount()
  width.layout(1024)
  expect(width.canDock()).toBe(false)
  width.layout(1024, 0)
  expect(width.canDock()).toBe(true)
  width.layout(360, 0)
  expect(width.canDock()).toBe(false)
})

it("uses the legacy width as a default and keeps a session preference across temporary limits", () => {
  localStorage.setItem(legacyKey, "900")
  const width = mount()
  expect(width.width()).toBe(900)
  width.resize(1200)
  expect(width.width()).toBe(1200)
  width.layout(1280)
  expect(width.width()).toBe(574)
  width.layout(755, 0)
  expect(width.canDock()).toBe(false)
  width.resize(363)
  width.layout(1920)
  expect(width.width()).toBe(1200)
  expect(localStorage.getItem(legacyKey)).toBe("900")
})

it("uses the preference of the current session without a remount", () => {
  const width = mount(780)
  expect(width.width()).toBe(780)
  width.prefer(430)
  expect(width.width()).toBe(430)
  width.prefer(780)
  expect(width.width()).toBe(780)
})

it("rejects invalid user widths and falls back if legacy storage is unavailable", () => {
  vi.spyOn(localStorage, "getItem").mockImplementation(() => { throw new Error("blocked") })
  const width = mount()
  expect(width.width()).toBe(520)
  for (const value of [NaN, Infinity, -1, 0]) width.resize(value)
  expect(width.width()).toBe(520)
})
