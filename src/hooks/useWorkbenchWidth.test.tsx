import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { getWorkbenchMaxWidth, MIN_CHAT_WIDTH, useWorkbenchWidth } from "./useWorkbenchWidth"

const storageKey = "lotus_next_inspector_w"
let root: Root
let host: HTMLDivElement
let resize: ReturnType<typeof useWorkbenchWidth>

function Harness({ sidebarWidth = 288 }: { sidebarWidth?: number }) {
  resize = useWorkbenchWidth(sidebarWidth)
  return <button onPointerDown={resize.startResize} />
}

function setViewportWidth(width: number) {
  vi.stubGlobal("innerWidth", width)
  act(() => window.dispatchEvent(new Event("resize")))
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear()
  vi.stubGlobal("innerWidth", 1920)
  host = document.body.appendChild(document.createElement("div"))
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  localStorage.clear()
})

it.each([
  [1280, 420, 498],
  [1280, 288, 630],
  [1920, 288, 1270],
  [1920, 0, 1559],
  [2560, 420, 1778],
])("allows viewport %i and sidebar %i to use %i pixels while reserving chat", (viewport, sidebar, expected) => {
  expect(getWorkbenchMaxWidth(viewport, sidebar)).toBe(expected)
  expect(viewport - sidebar - expected - (sidebar > 0 ? 2 : 1)).toBe(MIN_CHAT_WIDTH)
})

it("keeps a valid minimum on narrow viewports where the workbench is an overlay", () => {
  expect(getWorkbenchMaxWidth(375, 288)).toBe(360)
})

it("restores the saved wide preference after narrowing and expanding the window", () => {
  localStorage.setItem(storageKey, "1200")
  act(() => root.render(<Harness />))
  expect(resize.width).toBe(1200)
  setViewportWidth(1280)
  expect(resize.width).toBe(630)
  expect(localStorage.getItem(storageKey)).toBe("1200")
  setViewportWidth(1920)
  expect(resize.width).toBe(1200)
})

it("adjusts for sidebar resizing and collapse without losing the preferred width", () => {
  localStorage.setItem(storageKey, "1500")
  act(() => root.render(<Harness sidebarWidth={0} />))
  expect(resize.width).toBe(1500)
  act(() => root.render(<Harness />))
  expect(resize.width).toBe(1270)
  act(() => root.render(<Harness sidebarWidth={420} />))
  expect(resize.width).toBe(1138)
  act(() => root.render(<Harness sidebarWidth={0} />))
  expect(resize.width).toBe(1500)
  expect(localStorage.getItem(storageKey)).toBe("1500")
})

it("drags beyond both old width caps, persists, and restores after remount", () => {
  act(() => root.render(<Harness />))
  act(() => host.querySelector("button")!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 1500 })))
  act(() => {
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 820 }))
    window.dispatchEvent(new MouseEvent("pointerup"))
  })
  expect(resize.width).toBe(1200)
  expect(resize.width).toBeGreaterThan(840)
  expect(resize.width).toBeGreaterThan(window.innerWidth * 0.46)
  expect(localStorage.getItem(storageKey)).toBe("1200")
  act(() => root.render(null))
  setViewportWidth(1280)
  act(() => root.render(<Harness />))
  expect(resize.width).toBe(630)
  setViewportWidth(1920)
  expect(resize.width).toBe(1200)
})
