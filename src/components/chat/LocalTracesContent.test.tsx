import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { changeLocale } from "@shared/i18n"
import type { LocalTraceSource, TraceDetail, TracePage, TraceSummary } from "@services/traces/localTraces"
import { fixturePage, fixtureTrace, fixtureTraceDetail } from "@/test/fixtures/localTraceFixture"
import { LocalTracesContent } from "./LocalTracesContent"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const roots: Root[] = []
const list = vi.fn<LocalTraceSource["list"]>()
const detail = vi.fn<LocalTraceSource["detail"]>()
const source: LocalTraceSource = { list, detail }
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const text = () => document.body.textContent ?? ""
function button(value: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find((item) => item.textContent?.includes(value))
  if (!found) throw new Error(`Missing button: ${value}`)
  return found
}
async function click(value: string) { await act(async () => button(value).click()) }
async function mount(sessionId = "session-a") {
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  roots.push(root)
  const render = async (id: string) => act(async () => root.render(<LocalTracesContent sessionId={id} source={source} />))
  await render(sessionId)
  return { render }
}
function field(label: string): string | null {
  const dt = [...document.querySelectorAll("dt")].find((item) => item.textContent === label)
  return dt?.nextElementSibling?.textContent ?? null
}
beforeEach(async () => {
  await changeLocale("en-US")
  list.mockReset().mockResolvedValue(fixturePage)
  detail.mockReset().mockResolvedValue(fixtureTraceDetail)
})
afterEach(() => {
  roots.splice(0).forEach((root) => act(() => root.unmount()))
  document.body.replaceChildren()
})

describe("local trace presentation", () => {
  it("shows parent and child spans and preserves missing versus zero usage without rendering unrelated content", async () => {
    const unsafe = { ...fixtureTraceDetail, prompt: "PROMPT_SENTINEL", tool_body: "TOOL_BODY_SENTINEL", key: "KEY_SENTINEL", path: "/PRIVATE/PATH" }
    detail.mockResolvedValue(unsafe)
    await mount()
    expect(list).toHaveBeenCalledWith("session-a", "all", null, expect.any(AbortSignal))
    expect(detail).toHaveBeenCalledWith("session-a", fixtureTrace.traceId, expect.any(AbortSignal))
    expect(text()).toContain("Span timeline")
    expect(text()).toContain("Agent")
    expect(text()).toContain("Model call")
    expect(text()).toContain("Tool call")
    expect(text()).toContain("2,048 spans")
    expect(text()).toContain("Recording is best effort")
    await click("Model call")
    expect(field("Model")).toBe("fixture-model")
    expect(field("Provider")).toBe("fixture-provider")
    expect(field("Input")).toBe("1,250")
    expect(field("Output")).toBe("Unknown")
    expect(field("Cache read")).toBe("0")
    expect(field("Cache creation")).toBe("Unknown")
    expect(field("Cache write")).toBe("24")
    for (const value of ["PROMPT_SENTINEL", "TOOL_BODY_SENTINEL", "KEY_SENTINEL", "/PRIVATE/PATH"]) expect(text()).not.toContain(value)
  })

  it("shows unlinked or cyclic spans once with an unavailable-parent indication", async () => {
    detail.mockResolvedValue({ traceId: fixtureTrace.traceId, partial: true, spans: [
      { ...fixtureTraceDetail.spans[0], spanId: "a", parentSpanId: "b" },
      { ...fixtureTraceDetail.spans[1], spanId: "b", parentSpanId: "a" },
      { ...fixtureTraceDetail.spans[2], spanId: "c", parentSpanId: "removed" },
    ] })
    await mount()
    const timeline = document.querySelector('[aria-label="Span timeline"]')!
    expect(timeline.querySelectorAll("button")).toHaveLength(3)
    expect(timeline.textContent).toContain("parent unavailable")
  })

  it.each([
    ["disabled", "Local trace recording is disabled"],
    ["unsupported", "does not provide local trace inspection"],
  ] as const)("distinguishes %s from an empty recording", async (availability, message) => {
    list.mockResolvedValue({ availability, coverage: "unknown", traces: [], nextCursor: null, retention: null })
    await mount()
    expect(text()).toContain(message)
    expect(text()).not.toContain("No traces on this page")
    expect(detail).not.toHaveBeenCalled()
  })

  it("reports empty, retention truncation, and sanitized failures", async () => {
    list.mockResolvedValue({ ...fixturePage, traces: [], retention: { maxSpans: 2048, evictedSpans: 7 } })
    await mount()
    expect(text()).toContain("No traces on this page")
    expect(text()).toContain("7 evicted")
    list.mockRejectedValue(new Error("PRIVATE_PATH_OR_TOKEN"))
    await click("Refresh")
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("could not be read")
    expect(text()).not.toContain("PRIVATE_PATH_OR_TOKEN")
  })

  it("requests the selected filter and cursor, and returns to the previous page", async () => {
    const second: TraceSummary = { ...fixtureTrace, traceId: "fixture-trace-2", status: "error" }
    list.mockImplementation(async (_session, filter, cursor) => ({ ...fixturePage,
      traces: cursor ? [second] : [fixtureTrace], nextCursor: cursor ? null : "next-page" }))
    detail.mockImplementation(async (_session, traceId) => ({ ...fixtureTraceDetail, traceId }))
    await mount()
    await click("Next")
    expect(list).toHaveBeenLastCalledWith("session-a", "all", "next-page", expect.any(AbortSignal))
    expect(text()).toContain("Page 2")
    await click("Previous")
    expect(list).toHaveBeenLastCalledWith("session-a", "all", null, expect.any(AbortSignal))
    const select = document.querySelector("select")!
    await act(async () => { select.value = "error"; select.dispatchEvent(new Event("change", { bubbles: true })) })
    expect(list).toHaveBeenLastCalledWith("session-a", "error", null, expect.any(AbortSignal))
  })

  it("aborts stale session reads and never displays their late result", async () => {
    const pending = deferred<TracePage>()
    list.mockImplementation(async (session) => session === "session-a" ? pending.promise : { ...fixturePage, traces: [] })
    const { render } = await mount()
    const firstSignal = list.mock.calls[0][3]
    await render("session-b")
    expect(firstSignal.aborted).toBe(true)
    expect(text()).toContain("No traces on this page")
    await act(async () => pending.resolve(fixturePage))
    expect(text()).not.toContain("Span timeline")
    expect(detail).not.toHaveBeenCalled()
  })

  it("fences repeated refresh and a late detail from the previously selected trace", async () => {
    const second: TraceSummary = { ...fixtureTrace, traceId: "fixture-trace-2", status: "error", durationMs: 500 }
    list.mockResolvedValue({ ...fixturePage, traces: [fixtureTrace, second] })
    const pending = deferred<TraceDetail>()
    detail.mockImplementation(async (_session, id) => id === fixtureTrace.traceId ? pending.promise : { ...fixtureTraceDetail, traceId: id })
    await mount()
    const firstSignal = detail.mock.calls[0][2]
    await click("500 ms")
    expect(firstSignal.aborted).toBe(true)
    expect(text()).toContain("Span timeline")
    await act(async () => pending.resolve({ ...fixtureTraceDetail, spans: [{ ...fixtureTraceDetail.spans[0], model: "STALE_MODEL" }] }))
    expect(text()).not.toContain("STALE_MODEL")
    const refreshing = deferred<TracePage>()
    list.mockReturnValue(refreshing.promise)
    await act(async () => { button("Refresh").click(); button("Refresh").click() })
    expect(list).toHaveBeenCalledTimes(2)
    expect(button("Refresh").disabled).toBe(true)
    expect(text()).not.toContain("Span timeline")
    await act(async () => refreshing.resolve({ ...fixturePage, traces: [] }))
    expect(text()).toContain("No traces on this page")
  })

  it("rejects a detail for a different trace without rendering the response", async () => {
    detail.mockResolvedValue({ ...fixtureTraceDetail, traceId: "other-trace" })
    await mount()
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Span details could not be read")
    expect(text()).not.toContain("fixture-model")
  })
})
