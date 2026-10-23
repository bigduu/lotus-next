import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { useResizableWidth } from "./useResizableWidth"

const storageKey = "test_panel_width"
let root: Root
let host: HTMLDivElement
let resize: ReturnType<typeof useResizableWidth>

function Harness({ min = 360, max = 1200 }: { min?: number; max?: number }) {
  resize = useResizableWidth(storageKey, 520, { min, max })
  return <div style={{ width: resize.width }} />
}

const width = () => host.querySelector<HTMLDivElement>("div")!.style.width

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear()
  host = document.body.appendChild(document.createElement("div"))
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.style.cursor = ""
  document.body.style.userSelect = ""
  localStorage.clear()
})

it("restores a saved preference after temporary maximum and minimum changes", () => {
  localStorage.setItem(storageKey, "1100")
  act(() => root.render(<Harness max={700} />))
  expect(width()).toBe("700px")
  act(() => root.render(<Harness max={1400} />))
  expect(width()).toBe("1100px")
  act(() => root.render(<Harness min={1150} max={1400} />))
  expect(width()).toBe("1150px")
  act(() => root.render(<Harness max={1400} />))
  expect(width()).toBe("1100px")
  expect(localStorage.getItem(storageKey)).toBe("1100")
})

it("clamps the default width to the current bounds", () => {
  act(() => root.render(<Harness max={480} />))
  expect(width()).toBe("480px")
  act(() => root.render(<Harness />))
  expect(width()).toBe("520px")
})

it.each(["invalid", "Infinity", "NaN", "-1", "0", "520px", " "])(
  "ignores an invalid saved width %s",
  (saved) => {
    localStorage.setItem(storageKey, saved)
    act(() => root.render(<Harness />))
    expect(width()).toBe("520px")
  },
)

it("persists a completed user resize and restores it after remount", () => {
  act(() => root.render(<Harness />))
  act(() => resize.setWidth(1120))
  expect(width()).toBe("1120px")
  expect(localStorage.getItem(storageKey)).toBe("1120")
  act(() => root.render(null))
  act(() => root.render(<Harness max={700} />))
  expect(width()).toBe("700px")
  act(() => root.render(<Harness />))
  expect(width()).toBe("1120px")
})

it("clamps completed user changes to the latest limits", () => {
  act(() => root.render(<Harness max={600} />))
  act(() => root.render(<Harness max={1000} />))
  act(() => resize.setWidth(1100))
  expect(width()).toBe("1000px")
  act(() => root.render(<Harness min={650} max={700} />))
  act(() => resize.setWidth(500))
  expect(width()).toBe("650px")
  expect(localStorage.getItem(storageKey)).toBe("650")
})

it("keeps sidebar bounds without saving temporary viewport constraints", () => {
  localStorage.setItem(storageKey, "420")
  act(() => root.render(<Harness min={220} max={407} />))
  expect(width()).toBe("407px")
  expect(localStorage.getItem(storageKey)).toBe("420")
  act(() => root.render(<Harness min={220} max={420} />))
  expect(width()).toBe("420px")
  act(() => resize.setWidth(300))
  expect(localStorage.getItem(storageKey)).toBe("300")
})

it.each([NaN, Infinity, -1, 0])("ignores a non-positive or non-finite completed width %s", (next) => {
  act(() => root.render(<Harness />))
  act(() => resize.setWidth(next))
  expect(width()).toBe("520px")
  expect(localStorage.getItem(storageKey)).toBeNull()
})

it("keeps resizing usable when local storage is unavailable", () => {
  vi.spyOn(localStorage, "getItem").mockImplementation(() => { throw new Error("blocked") })
  vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("blocked") })
  act(() => root.render(<Harness />))
  act(() => resize.setWidth(620))
  expect(width()).toBe("620px")
})
