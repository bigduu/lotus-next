import { createRoot, createSignal, flush } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"
import { createStoredPanelWidth, type WidthBounds } from "./createPanelWidth"

const storageKey = "test_panel_width"
let panel: ReturnType<typeof createStoredPanelWidth>
let setLimits: (bounds: WidthBounds) => void
let dispose: (() => void) | undefined

function mount({ min = 360, max = 1200 } = {}) {
  dispose?.()
  createRoot((cleanup) => {
    dispose = cleanup
    const [limits, changeLimits] = createSignal({ min, max })
    setLimits = changeLimits
    panel = createStoredPanelWidth(storageKey, 520, limits)
  })
  flush()
}

function adapt({ min = 360, max = 1200 } = {}) {
  setLimits({ min, max })
  flush()
}

function resize(value: number) {
  panel.setWidth(value)
  flush()
}

const width = () => panel.width()

afterEach(() => {
  dispose?.()
  dispose = undefined
  localStorage.clear()
})

it("restores a saved preference after temporary maximum and minimum changes", () => {
  localStorage.setItem(storageKey, "1100")
  mount({ max: 700 })
  expect(width()).toBe(700)
  adapt({ max: 1400 })
  expect(width()).toBe(1100)
  adapt({ min: 1150, max: 1400 })
  expect(width()).toBe(1150)
  adapt({ max: 1400 })
  expect(width()).toBe(1100)
  expect(localStorage.getItem(storageKey)).toBe("1100")
})

it("clamps the default width to the current bounds", () => {
  mount({ max: 480 })
  expect(width()).toBe(480)
  adapt()
  expect(width()).toBe(520)
})

it.each(["invalid", "Infinity", "NaN", "-1", "0", "520px", " "])(
  "ignores an invalid saved width %s",
  (saved) => {
    localStorage.setItem(storageKey, saved)
    mount()
    expect(width()).toBe(520)
  },
)

it("persists a completed user resize and restores it after remount", () => {
  mount()
  resize(1120)
  expect(width()).toBe(1120)
  expect(localStorage.getItem(storageKey)).toBe("1120")
  mount({ max: 700 })
  expect(width()).toBe(700)
  adapt()
  expect(width()).toBe(1120)
})

it("clamps completed user changes to the latest limits", () => {
  mount({ max: 600 })
  adapt({ max: 1000 })
  resize(1100)
  expect(width()).toBe(1000)
  adapt({ min: 650, max: 700 })
  resize(500)
  expect(width()).toBe(650)
  expect(localStorage.getItem(storageKey)).toBe("650")
})

it("keeps sidebar bounds without saving temporary viewport constraints", () => {
  localStorage.setItem(storageKey, "420")
  mount({ min: 220, max: 407 })
  expect(width()).toBe(407)
  expect(localStorage.getItem(storageKey)).toBe("420")
  adapt({ min: 220, max: 420 })
  expect(width()).toBe(420)
  resize(300)
  expect(localStorage.getItem(storageKey)).toBe("300")
})

it.each([NaN, Infinity, -1, 0])("ignores a non-positive or non-finite completed width %s", (next) => {
  mount()
  resize(next)
  expect(width()).toBe(520)
  expect(localStorage.getItem(storageKey)).toBeNull()
})

it("keeps resizing usable when local storage is unavailable", () => {
  vi.spyOn(localStorage, "getItem").mockImplementation(() => { throw new Error("blocked") })
  vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("blocked") })
  mount()
  resize(620)
  expect(width()).toBe(620)
})
