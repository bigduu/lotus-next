import { act, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it } from "vitest"
import { getWorkbenchMaxWidth, MIN_DOCKED_CHAT_WIDTH, useWorkbenchWidth } from "./useWorkbenchWidth"

const legacyKey = "lotus_next_inspector_w"
let root: Root
let host: HTMLDivElement
let resize: ReturnType<typeof useWorkbenchWidth>

function Harness({ container = 1920, sidebar = 288, saved = null }: {
  container?: number
  sidebar?: number
  saved?: number | null
}) {
  const [preferredWidth, setPreferredWidth] = useState(saved)
  resize = useWorkbenchWidth(container, sidebar, preferredWidth, setPreferredWidth)
  return <div />
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear()
  host = document.body.appendChild(document.createElement("div"))
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  localStorage.clear()
})

it.each([
  [1280, 420, 442],
  [1280, 288, 574],
  [1920, 288, 1214],
  [1920, 0, 1503],
  [2560, 420, 1722],
])("reserves chat space inside a %i px container with a %i px sidebar", (container, sidebar, expected) => {
  expect(getWorkbenchMaxWidth(container, sidebar)).toBe(expected)
  expect(container - sidebar - expected - (sidebar > 0 ? 2 : 1)).toBe(MIN_DOCKED_CHAT_WIDTH)
})

it("switches to an overlay when the measured container cannot fit both columns", () => {
  act(() => root.render(<Harness container={1024} />))
  expect(resize.canDock).toBe(false)
  act(() => root.render(<Harness container={1024} sidebar={0} />))
  expect(resize.canDock).toBe(true)
  act(() => root.render(<Harness container={360} sidebar={0} />))
  expect(resize.canDock).toBe(false)
})

it("uses the legacy width as a default and keeps a session preference across temporary limits", () => {
  localStorage.setItem(legacyKey, "900")
  act(() => root.render(<Harness />))
  expect(resize.width).toBe(900)
  act(() => resize.setWidth(1200))
  expect(resize.width).toBe(1200)
  act(() => root.render(<Harness container={1280} />))
  expect(resize.width).toBe(574)
  act(() => root.render(<Harness container={755} sidebar={0} />))
  expect(resize.canDock).toBe(false)
  act(() => resize.setWidth(363))
  act(() => root.render(<Harness />))
  expect(resize.width).toBe(1200)
  expect(localStorage.getItem(legacyKey)).toBe("900")
})

it("uses the width supplied by the current session", () => {
  act(() => root.render(<Harness saved={780} key="session-a" />))
  expect(resize.width).toBe(780)
  act(() => root.render(<Harness saved={430} key="session-b" />))
  expect(resize.width).toBe(430)
  act(() => root.render(<Harness saved={780} key="session-a" />))
  expect(resize.width).toBe(780)
})
