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
  expect(state!.atBottom).toBe(false)
  act(() => { height = 1500; observer.fire() }); expect(el.scrollTop).toBe(880)
  act(() => state!.scrollToBottom()); expect(el.scrollTop).toBe(1200)
  act(() => { viewport = 200; observer.fire() }); expect(el.scrollTop).toBe(1300)
  act(() => root.render(<Harness session="b" />))
  expect(observer.disconnect).toHaveBeenCalledTimes(1)
  const second = observers.at(-1)!
  act(() => root.render(<Harness session={null} />))
  expect(second.disconnect).toHaveBeenCalledTimes(1)
  act(() => root.render(<Harness session="c" />))
  expect(observers.at(-1)!.observe).toHaveBeenCalledTimes(2)
})
