import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { useStickyScroll } from "./useStickyScroll"

const observers: Array<{ fire(): void; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = []
let dispose = () => {}
afterEach(() => { act(dispose); document.body.replaceChildren(); vi.unstubAllGlobals(); observers.length = 0 })

it("connects after home, follows both sizes, preserves upward reading and disconnects across navigation", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("ResizeObserver", class {
    observe = vi.fn(); disconnect = vi.fn()
    constructor(public fire: () => void) { observers.push(this) }
  })
  let state: ReturnType<typeof useStickyScroll>
  function Harness({ session }: { session: string | null }) {
    state = useStickyScroll(session)
    return session ? <div ref={state.scrollRef} onScroll={state.handleScroll}><div ref={state.contentRef} /></div> : null
  }
  const host = document.createElement("div"); document.body.append(host)
  const root = createRoot(host); dispose = () => root.unmount()
  const scrollTo = vi.fn(function (this: HTMLDivElement, options?: ScrollToOptions | number, y?: number) { this.scrollTop = Math.max(0, Math.min((typeof options === "number" ? y : options?.top) ?? 0, this.scrollHeight - this.clientHeight)) })
  const original = HTMLElement.prototype.scrollTo
  HTMLElement.prototype.scrollTo = scrollTo
  const oldDispose = dispose; dispose = () => { oldDispose(); HTMLElement.prototype.scrollTo = original }
  act(() => root.render(<Harness session={null} />))
  expect(observers).toHaveLength(0)
  act(() => root.render(<Harness session="a" />))
  const el = host.firstElementChild as HTMLDivElement
  let height = 1000; let viewport = 300
  Object.defineProperties(el, { scrollHeight: { get: () => height }, clientHeight: { get: () => viewport } })
  const observer = observers.at(-1)!
  expect(observer.observe.mock.calls.map(([node]) => node)).toEqual([el.firstElementChild, el])
  act(() => observer.fire()); expect(el.scrollTop).toBe(700)
  act(() => { height = 1200; observer.fire() }); expect(el.scrollTop).toBe(900)
  act(() => { el.scrollTop = 880; state!.handleScroll() })
  expect(state!.atBottom).toBe(true)
  expect(el.scrollTop).toBe(900)
  act(() => { height = 1300; observer.fire() }); expect(el.scrollTop).toBe(1000)
  el.dispatchEvent(new WheelEvent("wheel", { deltaY: -20 }))
  act(() => { el.scrollTop = 880; state!.handleScroll() })
  expect(state!.atBottom).toBe(false)
  act(() => { height = 1500; observer.fire() }); expect(el.scrollTop).toBe(880)
  act(() => state!.scrollToBottom()); expect(el.scrollTop).toBe(1200)
  act(() => { viewport = 200; observer.fire() }); expect(el.scrollTop).toBe(1300)
  el.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp" }))
  act(() => { el.scrollTop = 1280; state!.handleScroll() })
  expect(state!.atBottom).toBe(false)
  act(() => state!.pinToBottom())
  const touch = (type: string, clientY: number) => {
    const event = new Event(type)
    Object.defineProperty(event, "touches", { value: [{ clientY }] })
    el.dispatchEvent(event)
  }
  touch("touchstart", 50); touch("touchmove", 80)
  act(() => { el.scrollTop = 1280; state!.handleScroll() })
  expect(state!.atBottom).toBe(false)
  act(() => state!.pinToBottom())
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({ right: 100 } as DOMRect)
  el.dispatchEvent(new MouseEvent("pointerdown", { clientX: 95 }))
  act(() => { el.scrollTop = 1280; state!.handleScroll() })
  expect(state!.atBottom).toBe(false)
  window.dispatchEvent(new Event("pointerup"))
  act(() => state!.pinToBottom())
  el.firstElementChild!.dispatchEvent(new MouseEvent("pointerdown", { clientX: 20, bubbles: true }))
  act(() => { el.scrollTop = 1280; state!.handleScroll() })
  expect(state!.atBottom).toBe(true)
  act(() => root.render(<Harness session="b" />))
  expect(observer.disconnect).toHaveBeenCalledTimes(1)
  const second = observers.at(-1)!
  act(() => root.render(<Harness session={null} />))
  expect(second.disconnect).toHaveBeenCalledTimes(1)
  act(() => root.render(<Harness session="c" />))
  expect(observers.at(-1)!.observe).toHaveBeenCalledTimes(2)
})

function mountScrollableChat() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("ResizeObserver", class {
    observe = vi.fn(); disconnect = vi.fn()
    constructor(public fire: () => void) { observers.push(this) }
  })
  let state: ReturnType<typeof useStickyScroll>
  function Harness() {
    state = useStickyScroll("streaming-session")
    return <div ref={state.scrollRef} onScroll={state.handleScroll}><div ref={state.contentRef}><input /></div></div>
  }
  const host = document.createElement("div"); document.body.append(host)
  const root = createRoot(host)
  const original = HTMLElement.prototype.scrollTo
  const scrollTo = vi.fn(function (this: HTMLDivElement, options?: ScrollToOptions | number, y?: number) {
    this.scrollTop = Math.max(0, Math.min((typeof options === "number" ? y : options?.top) ?? 0, this.scrollHeight - this.clientHeight))
  })
  HTMLElement.prototype.scrollTo = scrollTo
  dispose = () => { root.unmount(); HTMLElement.prototype.scrollTo = original }
  act(() => root.render(<Harness />))
  const el = host.firstElementChild as HTMLDivElement
  let height = 1000
  Object.defineProperties(el, { scrollHeight: { get: () => height }, clientHeight: { value: 300 } })
  const observer = observers.at(-1)!
  act(() => observer.fire())
  scrollTo.mockClear()
  return {
    el, scrollTo, observer,
    state: () => state!,
    growContent: () => { height += 200; observer.fire() },
  }
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
  expect(chat.state().atBottom).toBe(false)
  act(() => {
    chat.el.scrollTop = 660
    chat.growContent()
    chat.state().handleScroll()
  })
  expect(chat.el.scrollTop).toBe(660)
  act(() => chat.growContent())
  expect(chat.el.scrollTop).toBe(660)
  act(() => chat.state().pinToBottom())
  expect(chat.el.scrollTop).toBe(1300)
  expect(chat.state().atBottom).toBe(true)
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

it("keeps following for downward wheel input and editing keys inside the transcript", () => {
  const chat = mountScrollableChat()
  act(() => {
    chat.el.dispatchEvent(new WheelEvent("wheel", { deltaY: 40 }))
    chat.el.querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }))
    chat.growContent()
  })
  expect(chat.el.scrollTop).toBe(900)
  expect(chat.state().atBottom).toBe(true)
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
  expect(chat.state().atBottom).toBe(true)
  expect(chat.el.scrollTop).toBe(900)
  act(() => {
    output.scrollTop = 0
    output.dispatchEvent(new WheelEvent("wheel", { deltaY: -40, bubbles: true }))
    chat.growContent()
  })
  expect(chat.state().atBottom).toBe(false)
  expect(chat.el.scrollTop).toBe(900)
})
