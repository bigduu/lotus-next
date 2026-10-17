import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { useResizableWidth } from "./useResizableWidth"

const storageKey = "test_panel_width"
let root: Root
let host: HTMLDivElement

function Harness({ min = 360, max = 1200, edge = "left" }: {
  min?: number
  max?: number
  edge?: "left" | "right"
}) {
  const resize = useResizableWidth(storageKey, 520, { min, max, edge })
  return <button onPointerDown={resize.startResize} style={{ width: resize.width }} />
}

const width = () => host.querySelector<HTMLButtonElement>("button")!.style.width
const startResize = (clientX = 1000) => act(() => {
  host.querySelector("button")!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX }))
})
const move = (clientX: number) => window.dispatchEvent(new MouseEvent("pointermove", { clientX }))
const release = () => window.dispatchEvent(new MouseEvent("pointerup"))

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

it("persists the final pointer movement even when release precedes the next render", () => {
  act(() => root.render(<Harness />))
  startResize()
  act(() => {
    move(400)
    release()
  })
  expect(width()).toBe("1120px")
  expect(localStorage.getItem(storageKey)).toBe("1120")
})

it("uses new bounds on subsequent drags and while a drag is in progress", () => {
  act(() => root.render(<Harness max={600} />))
  act(() => root.render(<Harness max={1000} />))
  startResize()
  act(() => move(0))
  expect(width()).toBe("1000px")
  act(() => root.render(<Harness max={700} />))
  expect(width()).toBe("700px")
  act(() => move(900))
  expect(width()).toBe("620px")
  act(() => root.render(<Harness min={650} max={700} />))
  act(() => move(850))
  expect(width()).toBe("670px")
  act(() => {
    move(1200)
    release()
  })
  expect(width()).toBe("650px")
  expect(localStorage.getItem(storageKey)).toBe("650")
})

it("does not overwrite a clamped preference when the divider is only clicked", () => {
  localStorage.setItem(storageKey, "1100")
  act(() => root.render(<Harness max={700} />))
  startResize()
  act(() => release())
  expect(localStorage.getItem(storageKey)).toBe("1100")
  act(() => root.render(<Harness />))
  expect(width()).toBe("1100px")
})

it("starts dragging from the visible width instead of an offscreen saved width", () => {
  localStorage.setItem(storageKey, "1100")
  act(() => root.render(<Harness max={700} />))
  startResize()
  act(() => {
    move(1100)
    release()
  })
  expect(width()).toBe("600px")
  expect(localStorage.getItem(storageKey)).toBe("600")
  act(() => root.render(<Harness />))
  expect(width()).toBe("600px")
})

it("retains right-edge sidebar resizing and its width limits", () => {
  localStorage.setItem(storageKey, "288")
  act(() => root.render(<Harness min={220} max={420} edge="right" />))
  startResize(300)
  act(() => move(450))
  expect(width()).toBe("420px")
  act(() => {
    move(100)
    release()
  })
  expect(width()).toBe("220px")
  expect(localStorage.getItem(storageKey)).toBe("220")
})

it("cleans up cancelled drags and restores the previous body styles", () => {
  document.body.style.cursor = "crosshair"
  document.body.style.userSelect = "text"
  act(() => root.render(<Harness />))
  startResize()
  expect(document.body.style.cursor).toBe("col-resize")
  expect(document.body.style.userSelect).toBe("none")
  act(() => {
    move(900)
    window.dispatchEvent(new MouseEvent("pointercancel"))
  })
  expect(document.body.style.cursor).toBe("crosshair")
  expect(document.body.style.userSelect).toBe("text")
  act(() => move(0))
  expect(width()).toBe("620px")
})

it("removes active drag listeners on unmount without saving a partial drag", () => {
  const save = vi.spyOn(Storage.prototype, "setItem")
  act(() => root.render(<Harness />))
  startResize()
  act(() => move(800))
  act(() => root.render(null))
  act(() => {
    move(0)
    release()
  })
  expect(document.body.style.cursor).toBe("")
  expect(document.body.style.userSelect).toBe("")
  expect(save).not.toHaveBeenCalled()
})

it("still resizes when local storage is unavailable", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked") })
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked") })
  act(() => root.render(<Harness />))
  startResize()
  act(() => {
    move(900)
    release()
  })
  expect(width()).toBe("620px")
})
