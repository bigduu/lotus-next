import { createRoot, flush } from "solid-js"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { createStickyHistoryFollow } from "./createStickyHistoryFollow"

const observers: Array<{ fire(): void; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = []
let dispose: (() => void) | undefined
let frameId = 0
const frames = new Map<number, FrameRequestCallback>()

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe = vi.fn()
    disconnect = vi.fn()
    constructor(public fire: () => void) { observers.push(this) }
  })
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = ++frameId
    frames.set(id, callback)
    return id
  })
  vi.stubGlobal("cancelAnimationFrame", (id: number) => { frames.delete(id) })
})
afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  observers.length = 0
  frames.clear()
})

function act(action: () => void) {
  action()
  flush()
  for (const [id, render] of [...frames]) {
    if (!frames.delete(id)) continue
    render(performance.now())
  }
  flush()
}

function mountFollow() {
  dispose?.()
  return createRoot((cleanup) => {
    dispose = cleanup
    return createStickyHistoryFollow(true)
  })
}

function mountViewport() {
  const el = document.body.appendChild(document.createElement("div"))
  const content = el.appendChild(document.createElement("div"))
  content.appendChild(document.createElement("input"))
  let height = 1000
  let viewport = 300
  const scrollTo = vi.fn((options: ScrollToOptions) => {
    el.scrollTop = Math.max(0, Math.min(options.top ?? 0, height - viewport))
  })
  Object.defineProperties(el, {
    scrollHeight: { get: () => height }, clientHeight: { get: () => viewport }, scrollTo: { value: scrollTo },
  })
  return { el, scrollTo, setGeometry(nextHeight: number, nextViewport = viewport) { height = nextHeight; viewport = nextViewport } }
}

it("connects after home, follows both sizes, preserves upward reading and disconnects across navigation", () => {
  let state = mountFollow()
  expect(observers).toHaveLength(0)
  const { el, setGeometry } = mountViewport()
  act(() => state.bind(el))
  const observer = observers.at(-1)!
  expect(observer.observe.mock.calls.map(([node]) => node)).toHaveLength(2)
  expect(observer.observe.mock.calls.map(([node]) => node)).toEqual(expect.arrayContaining([el.firstElementChild, el]))
  act(() => observer.fire())
  expect(el.scrollTop).toBe(700)
  act(() => { setGeometry(1200); observer.fire() })
  expect(el.scrollTop).toBe(900)
  act(() => { el.scrollTop = 880; state.onScroll() })
  expect(state.following()).toBe(true)
  expect(el.scrollTop).toBe(900)
  act(() => { setGeometry(1300); observer.fire() })
  expect(el.scrollTop).toBe(1000)
  el.dispatchEvent(new WheelEvent("wheel", { deltaY: -20 }))
  act(() => { el.scrollTop = 880; state.onScroll() })
  expect(state.following()).toBe(false)
  act(() => { setGeometry(1500); observer.fire() })
  expect(el.scrollTop).toBe(880)
  act(state.resume)
  expect(el.scrollTop).toBe(1200)
  act(() => { setGeometry(1500, 200); observer.fire() })
  expect(el.scrollTop).toBe(1300)
  el.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp" }))
  act(() => { el.scrollTop = 1280; state.onScroll() })
  expect(state.following()).toBe(false)
  act(state.resume)
  for (const [type, clientY] of [["touchstart", 50], ["touchmove", 80]] as const) {
    const event = new Event(type)
    Object.defineProperty(event, "touches", { value: [{ clientY }] })
    el.dispatchEvent(event)
  }
  act(() => { el.scrollTop = 1280; state.onScroll() })
  expect(state.following()).toBe(false)
  act(state.resume)
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({ right: 100 } as DOMRect)
  el.dispatchEvent(new MouseEvent("pointerdown", { clientX: 95 }))
  act(() => { el.scrollTop = 1280; state.onScroll() })
  expect(state.following()).toBe(false)
  window.dispatchEvent(new Event("pointerup"))
  act(state.resume)
  el.firstElementChild!.dispatchEvent(new MouseEvent("pointerdown", { clientX: 20, bubbles: true }))
  act(() => { el.scrollTop = 1280; state.onScroll() })
  expect(state.following()).toBe(true)
  state = mountFollow()
  act(() => state.bind(mountViewport().el))
  expect(observer.disconnect).toHaveBeenCalledTimes(1)
  const second = observers.at(-1)!
  state = mountFollow()
  expect(second.disconnect).toHaveBeenCalledTimes(1)
  act(() => state.bind(mountViewport().el))
  expect(observers.at(-1)!.observe).toHaveBeenCalledTimes(2)
})

function mountScrollableChat() {
  const { el, scrollTo, setGeometry } = mountViewport()
  const state = mountFollow()
  act(() => state.bind(el))
  const observer = observers.at(-1)!
  act(() => observer.fire())
  scrollTo.mockClear()
  let height = 1000
  return { el, scrollTo, observer, state, growContent: () => { height += 200; setGeometry(height); observer.fire() } }
}

it.each(["wheel", "keyboard", "touch"])("releases %s intent before a streaming resize can steal the scroll", (input) => {
  const chat = mountScrollableChat()
  act(() => {
    if (input === "wheel") chat.el.dispatchEvent(new WheelEvent("wheel", { deltaY: -40 }))
    if (input === "keyboard") chat.el.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp" }))
    if (input === "touch") {
      for (const [type, clientY] of [["touchstart", 50], ["touchmove", 90]] as const) {
        const event = new Event(type)
        Object.defineProperty(event, "touches", { value: [{ clientY }] })
        chat.el.dispatchEvent(event)
      }
    }
    // Resize delivery can precede the browser's scroll event and even the
    // native scroll offset change. Neither ordering may erase user intent.
    chat.growContent()
  })
  expect(chat.el.scrollTop).toBe(700)
  expect(chat.scrollTo).not.toHaveBeenCalled()
  expect(chat.state.following()).toBe(false)
  act(() => {
    chat.el.scrollTop = 660
    chat.growContent()
    chat.state.onScroll()
  })
  expect(chat.el.scrollTop).toBe(660)
  act(() => chat.growContent())
  expect(chat.el.scrollTop).toBe(660)
  act(() => chat.state.resume())
  expect(chat.el.scrollTop).toBe(1300)
  expect(chat.state.following()).toBe(true)
  act(() => chat.growContent())
  expect(chat.el.scrollTop).toBe(1500)
})

it("does not rewrite the scroll offset when resize deliveries leave the bottom unchanged", () => {
  const chat = mountScrollableChat()
  act(() => { chat.observer.fire(); chat.observer.fire() })
  expect(chat.scrollTo).not.toHaveBeenCalled()
  act(() => chat.growContent())
  expect(chat.scrollTo).toHaveBeenCalledTimes(1)
  expect(chat.el.scrollTop).toBe(900)
})

it.each(["wheel", "keyboard", "touch", "scrollbar"])("waits for a deliberate %s return after a measurement reaches the bottom", (input) => {
  const chat = mountScrollableChat()
  act(() => {
    chat.el.dispatchEvent(new WheelEvent("wheel", { deltaY: -100 }))
    chat.el.scrollTop = 600
    chat.state.onScroll()
  })
  act(() => {
    // A virtualizer adjustment can be clamped to the bottom without any
    // downward input, including when part of a transcript is not virtualized.
    chat.el.scrollTop = 700
    chat.state.onScroll()
  })
  expect(chat.state.following()).toBe(false)
  act(() => chat.growContent())
  expect(chat.el.scrollTop).toBe(700)

  act(() => {
    if (input === "wheel") chat.el.dispatchEvent(new WheelEvent("wheel", { deltaY: 200 }))
    if (input === "keyboard") chat.el.dispatchEvent(new KeyboardEvent("keydown", { key: "End" }))
    if (input === "touch") {
      for (const [type, clientY] of [["touchstart", 120], ["touchmove", 50]] as const) {
        const event = new Event(type)
        Object.defineProperty(event, "touches", { value: [{ clientY }] })
        chat.el.dispatchEvent(event)
      }
    }
    if (input === "scrollbar") {
      vi.spyOn(chat.el, "getBoundingClientRect").mockReturnValue({ right: 100 } as DOMRect)
      chat.el.dispatchEvent(new MouseEvent("pointerdown", { clientX: 95 }))
      window.dispatchEvent(new Event("pointerup"))
    }
    chat.el.scrollTop = 900
    chat.state.onScroll()
  })
  expect(chat.state.following()).toBe(true)
  act(() => chat.growContent())
  expect(chat.el.scrollTop).toBe(1100)
})

it("keeps following for downward wheel input and editing keys inside the transcript", () => {
  const chat = mountScrollableChat()
  act(() => {
    chat.el.dispatchEvent(new WheelEvent("wheel", { deltaY: 40 }))
    chat.el.querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }))
    chat.growContent()
  })
  expect(chat.el.scrollTop).toBe(900)
  expect(chat.state.following()).toBe(true)
})

it("does not release the transcript while a nested tool output consumes upward scrolling", () => {
  const chat = mountScrollableChat()
  const output = chat.el.firstElementChild as HTMLElement
  output.style.overflowY = "auto"
  output.scrollTop = 100
  act(() => {
    output.dispatchEvent(new WheelEvent("wheel", { deltaY: -40, bubbles: true }))
    chat.growContent()
  })
  expect(chat.state.following()).toBe(true)
  expect(chat.el.scrollTop).toBe(900)
  act(() => {
    output.scrollTop = 0
    output.dispatchEvent(new WheelEvent("wheel", { deltaY: -40, bubbles: true }))
    chat.growContent()
  })
  expect(chat.state.following()).toBe(false)
  expect(chat.el.scrollTop).toBe(900)
})
