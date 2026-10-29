import { act, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { uiText } from "@shared/i18n/ui"
import type { RunDiagnosticsSubject } from "@/lib/runDiagnosticId"
import { RunDiagnosticsEntry, type RunDiagnosticsContentProps } from "./RunDiagnosticsEntry"
import { RunDiagnosticsDialogContent } from "./RunDiagnosticsDialogContent"
import { generatedDiagnosticError } from "@services/chat/runDiagnostic"
import { diagnosticFixture, diagnosticFixtureError, timeoutDiagnosticFixture, timeoutDiagnosticFixtureError } from "@services/chat/runDiagnostic.testFixtures"

const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
environment.IS_REACT_ACT_ENVIRONMENT = true
const a: RunDiagnosticsSubject = { sessionId: "11111111-1111-4111-8111-111111111111", localOperationId: 1, failureKind: "generation-failed",
  diagnosticId: "9ab6cd70-bc43-4fed-9f10-50c2873fa287" }
const b: RunDiagnosticsSubject = { ...a, sessionId: "22222222-2222-4222-8222-222222222222", diagnosticId: "fa6aa794-30d4-4e8b-a222-46b35c8348d9" }
const roots: { root: Root; container: HTMLElement }[] = []
function mount(element: React.ReactNode) {
  const container = document.body.appendChild(document.createElement("div")), root = createRoot(container)
  roots.push({ root, container }); act(() => root.render(element)); return root
}
function button(text: string) { return [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === text)! }
async function click(text: string) { await act(async () => button(text).click()) }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
afterEach(() => {
  for (const { root, container } of roots.splice(0)) { act(() => root.unmount()); container.remove() }
  vi.unstubAllGlobals(); vi.restoreAllMocks()
})

describe("review and explicit local diagnostic download", () => {
  it("downloads the initial preview under StrictMode without requiring a service read", async () => {
    const download = vi.fn(), readSession = vi.fn()
    mount(<StrictMode><RunDiagnosticsDialogContent subject={a} isCurrent={() => true} onClose={vi.fn()} download={download} readSession={readSession} /></StrictMode>)
    const preview = JSON.parse(document.querySelector("pre")!.textContent!)
    await click(uiText("run_diagnostics_download"))
    expect(download).toHaveBeenCalledExactlyOnceWith(preview)
    expect(readSession).not.toHaveBeenCalled()
  })
  it("only previews on open; downloads only after explicit action, without network or generation", async () => {
    const download = vi.fn(), fetch = vi.fn(); vi.stubGlobal("fetch", fetch)
    mount(<RunDiagnosticsDialogContent subject={a} isCurrent={() => true} onClose={vi.fn()} download={download} />)
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(a.diagnosticId)
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(uiText("run_diagnostics_not_provided"))
    const preview = JSON.parse(document.querySelector("pre")!.textContent!)
    expect(preview.diagnostic).toMatchObject({ diagnostic_id: a.diagnosticId, attempt: null, attempt_limit: null, retry_stop_reason: null })
    expect(download).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
    await click(uiText("run_diagnostics_download"))
    expect(download).toHaveBeenCalledTimes(1); expect(download.mock.calls[0]?.[0]).toEqual(preview)
    expect(fetch).not.toHaveBeenCalled()
    expect([...document.querySelectorAll('[role="status"]')].some((item) => item.textContent === uiText("run_diagnostics_download_requested"))).toBe(true)
  })
  it("supports legacy missing details and closing without download", async () => {
    const close = vi.fn(), download = vi.fn()
    mount(<RunDiagnosticsDialogContent subject={{ ...a, diagnosticId: null }} isCurrent={() => true} onClose={close} download={download} />)
    expect(JSON.parse(document.querySelector("pre")!.textContent!).diagnostic.source).toBe("not_provided")
    await click(uiText("close_3fd47edc"))
    expect(close).toHaveBeenCalledTimes(1); expect(download).not.toHaveBeenCalled()
  })
  it("guards a stale download handler at action time", async () => {
    let current = true
    const download = vi.fn()
    mount(<RunDiagnosticsDialogContent subject={a} isCurrent={() => current} onClose={vi.fn()} download={download} />)
    current = false
    await click(uiText("run_diagnostics_download"))
    expect(download).not.toHaveBeenCalled(); expect(document.body.textContent).not.toContain(uiText("run_diagnostics_download_requested"))
  })
  it("does not echo private failure text when the local download throws", async () => {
    mount(<RunDiagnosticsDialogContent subject={a} isCurrent={() => true} onClose={vi.fn()}
      download={() => { throw new Error("sk-PRIVATE_DOWNLOAD_FAILURE") }} />)
    await click(uiText("run_diagnostics_download"))
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(uiText("run_diagnostics_download_failed"))
    expect(document.body.textContent).not.toContain("PRIVATE_DOWNLOAD_FAILURE")
  })
})

describe("optional loading and session/failure isolation", () => {
  it("invalidates a closed preview action even after reopening the identical failure", async () => {
    let props: RunDiagnosticsContentProps | null = null
    const Capture = (p: RunDiagnosticsContentProps) => { props = p; return <RunDiagnosticsDialogContent {...p} /> }
    mount(<RunDiagnosticsEntry subject={a} loadDialog={async () => ({ RunDiagnosticsDialogContent: Capture })} />)
    await click(uiText("run_diagnostics_open"))
    const closed = props!; expect(closed.isCurrent()).toBe(true)
    await click(uiText("close_3fd47edc"))
    expect(closed.isCurrent()).toBe(false)
    await click(uiText("run_diagnostics_open"))
    expect(props!.isCurrent()).toBe(true)
    expect(closed.isCurrent()).toBe(false)
  })

  it("can load again after an optional import failure was closed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const load = vi.fn<() => Promise<{ RunDiagnosticsDialogContent: typeof RunDiagnosticsDialogContent }>>()
      .mockRejectedValueOnce(new Error("one synthetic load failure"))
      .mockResolvedValue({ RunDiagnosticsDialogContent })
    mount(<RunDiagnosticsEntry subject={a} loadDialog={load} />)
    await click(uiText("run_diagnostics_open"))
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(uiText("run_diagnostics_load_failed"))
    await click(uiText("cancel_2cd0f3be")); await click(uiText("run_diagnostics_open"))
    expect(load).toHaveBeenCalledTimes(2)
    expect(document.querySelector("pre")?.textContent).toContain(a.diagnosticId)
  })

  it("does not load until clicked and never reopens after cancellation before load", async () => {
    const pending = deferred<{ RunDiagnosticsDialogContent: typeof RunDiagnosticsDialogContent }>()
    const load = vi.fn(() => pending.promise)
    mount(<RunDiagnosticsEntry subject={a} loadDialog={load} />)
    expect(load).not.toHaveBeenCalled()
    await click(uiText("run_diagnostics_open")); expect(load).toHaveBeenCalledTimes(1)
    await click(uiText("cancel_2cd0f3be"))
    await act(async () => pending.resolve({ RunDiagnosticsDialogContent }))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
  it("drops a pending old-session dialog and uses only the new session on explicit reopen", async () => {
    const pending = deferred<{ RunDiagnosticsDialogContent: typeof RunDiagnosticsDialogContent }>()
    const load = () => pending.promise
    const root = mount(<RunDiagnosticsEntry subject={a} loadDialog={load} />)
    await click(uiText("run_diagnostics_open"))
    await act(async () => root.render(<RunDiagnosticsEntry subject={b} loadDialog={load} />))
    await act(async () => pending.resolve({ RunDiagnosticsDialogContent }))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await click(uiText("run_diagnostics_open"))
    const preview = JSON.parse(document.querySelector("pre")!.textContent!)
    expect(preview.context.session_id).toBe(b.sessionId); expect(preview.diagnostic.diagnostic_id).toBe(b.diagnosticId)
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain(a.diagnosticId)
  })
  it("invalidates an existing preview and its action guard for a newer failure in the same session", async () => {
    let props: RunDiagnosticsContentProps | null = null
    const Capture = (p: RunDiagnosticsContentProps) => { props = p; return <RunDiagnosticsDialogContent {...p} /> }
    const load = async () => ({ RunDiagnosticsDialogContent: Capture })
    const root = mount(<RunDiagnosticsEntry subject={a} loadDialog={load} />)
    await click(uiText("run_diagnostics_open"))
    const old = props!; expect(old.isCurrent()).toBe(true)
    await act(async () => root.render(<RunDiagnosticsEntry subject={{ ...a, localOperationId: 2 }} loadDialog={load} />))
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(old.isCurrent()).toBe(false)
    act(() => root.unmount()); roots.splice(roots.findIndex((item) => item.root === root), 1)[0]?.container.remove()
    expect(old.isCurrent()).toBe(false)
  })
  it("keeps an optional-loader failure cancellable without an action", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    mount(<RunDiagnosticsEntry subject={a} loadDialog={() => Promise.reject(new Error("synthetic loader failure"))} />)
    await click(uiText("run_diagnostics_open"))
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(uiText("run_diagnostics_load_failed"))
    await click(uiText("cancel_2cd0f3be")); expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
})

describe("v2 canonical diagnostic read and refresh", () => {
  it("shows timeout progress and exports only the current saved timeout without replaying it", async () => {
    const diagnostic = timeoutDiagnosticFixture(a.sessionId!)
    const timeoutSubject = { ...a,errorBinding:timeoutDiagnosticFixtureError,liveDiagnostic:diagnostic }
    let current: unknown = diagnostic
    const readSession = vi.fn(async () => ({ session:{ id:a.sessionId,is_running:false,last_run_status:"error",
      last_run_error:timeoutDiagnosticFixtureError,last_run_diagnostic:current } })), download = vi.fn()
    mount(<RunDiagnosticsDialogContent subject={timeoutSubject} isCurrent={() => true} onClose={vi.fn()} readSession={readSession} download={download} />)
    const details = document.querySelector("dl")!
    expect(details.textContent).toContain(uiText("run_diagnostics_phase_transport_idle"))
    expect(details.textContent).toContain("120000 ms")
    expect(details.textContent).toContain(uiText("run_diagnostics_retry_unsafe"))
    expect(details.textContent).not.toContain(uiText("run_diagnostics_attempts"))
    expect(readSession).not.toHaveBeenCalled()
    await click(uiText("run_diagnostics_read"))
    await click(uiText("run_diagnostics_download"))
    expect(download.mock.calls[0]?.[0].diagnostic).toMatchObject({ source:"canonical_read",canonical_status:"confirmed",
      kind:"stream_timeout",deadline_ms:120000,semantic_output_started:true,retry_safe:false,attempt:null })
    current = null
    await click(uiText("run_diagnostics_read"))
    expect(JSON.parse(document.querySelector("pre")!.textContent!).diagnostic).toMatchObject({ source:"legacy_terminal_error_marker",
      canonical_status:"not_provided",kind:null,deadline_ms:null,semantic_output_started:null,retry_safe:null })
    expect(document.querySelector("dl")!.textContent).not.toContain("120000 ms")
  })

  const subject = { ...a,errorBinding:diagnosticFixtureError,liveDiagnostic:diagnosticFixture(a.sessionId!) }
  const receipt = () => ({ session:{ id:a.sessionId,is_running:false,last_run_status:"error",last_run_error:diagnosticFixtureError,last_run_diagnostic:diagnosticFixture(a.sessionId!) } })
  it("shows scoped live evidence, reads explicitly, and labels a canonical receipt without uploading", async () => {
    const readSession = vi.fn(async () => receipt()), download = vi.fn()
    mount(<RunDiagnosticsDialogContent subject={subject} isCurrent={() => true} onClose={vi.fn()} readSession={readSession} download={download} />)
    expect(readSession).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain(uiText("run_diagnostics_live"))
    expect(JSON.parse(document.querySelector("pre")!.textContent!).diagnostic.attempt_limit).toBe(4)
    await click(uiText("run_diagnostics_read"))
    expect(readSession).toHaveBeenCalledExactlyOnceWith(a.sessionId)
    expect(document.body.textContent).toContain(uiText("run_diagnostics_canonical"))
    await click(uiText("run_diagnostics_download"))
    expect(download.mock.calls[0]?.[0].diagnostic).toMatchObject({ source:"canonical_read",attempt:1,attempt_limit:4,canonical_status:"confirmed" })
  })
  it.each([undefined,null])("missing refreshed receipt clears previous live/canonical fields %s", async (missing) => {
    let value: unknown = diagnosticFixture(a.sessionId!)
    const readSession = vi.fn(async () => ({ session:{ ...receipt().session,last_run_diagnostic:value } }))
    mount(<RunDiagnosticsDialogContent subject={subject} isCurrent={() => true} onClose={vi.fn()} readSession={readSession} />)
    await click(uiText("run_diagnostics_read"))
    value = missing
    await click(uiText("run_diagnostics_read"))
    const data = JSON.parse(document.querySelector("pre")!.textContent!).diagnostic
    expect(data.canonical_status).toBe("not_provided"); expect(data.failure_stage).toBeNull(); expect(data.attempt).toBeNull()
  })
  it("withdraws details immediately during refresh and rejects a replaced active run", async () => {
    const response = deferred<{ session: unknown }>(), download = vi.fn()
    mount(<RunDiagnosticsDialogContent subject={subject} isCurrent={() => true} onClose={vi.fn()} readSession={() => response.promise} download={download} />)
    await click(uiText("run_diagnostics_read"))
    expect(JSON.parse(document.querySelector("pre")!.textContent!).diagnostic.failure_stage).toBeNull()
    await act(async () => response.resolve({ session:{ ...receipt().session,is_running:true } }))
    expect(document.querySelector("pre")!.textContent).toBe("null")
    expect(button(uiText("run_diagnostics_download")).disabled).toBe(true)
    expect(download).not.toHaveBeenCalled()
  })
  it("ignores a completed read after session/failure invalidation", async () => {
    let current = true
    const response = deferred<{ session: unknown }>()
    mount(<RunDiagnosticsDialogContent subject={subject} isCurrent={() => current} onClose={vi.fn()} readSession={() => response.promise} />)
    await click(uiText("run_diagnostics_read")); current = false
    await act(async () => response.resolve(receipt()))
    expect(document.body.textContent).not.toContain(uiText("run_diagnostics_canonical"))
  })
  it("a failed read clears old fields without echoing the transport error", async () => {
    mount(<RunDiagnosticsDialogContent subject={subject} isCurrent={() => true} onClose={vi.fn()} readSession={async () => { throw new Error("PRIVATE_CANARY_key") }} />)
    await click(uiText("run_diagnostics_read"))
    expect(document.body.textContent).not.toContain("PRIVATE_CANARY")
    expect(JSON.parse(document.querySelector("pre")!.textContent!).diagnostic).toMatchObject({ canonical_status:"unavailable",failure_stage:null,attempt:null })
  })
})


it("renders and exports continuous stop evidence without a fabricated finite limit",async()=>{
  const d={...diagnosticFixture(a.sessionId!),retry_mode:"until_cancelled" as const,attempt:7,attempt_limit:null,
    total_budget_ms:null,remaining_budget_ms:null,stop_reason:"cancelled_or_dropped" as const}
  const download=vi.fn(),readSession=vi.fn()
  mount(<RunDiagnosticsDialogContent subject={{...a,errorBinding:generatedDiagnosticError(d),liveDiagnostic:d}}
    isCurrent={()=>true} onClose={vi.fn()} readSession={readSession} download={download}/>)
  const details=document.querySelector("dl")!
  expect(details.textContent).toContain(uiText("run_diagnostics_continuous_attempts",{count:7}))
  expect(details.textContent).not.toContain("7 / null")
  expect(readSession).not.toHaveBeenCalled()
  await click(uiText("run_diagnostics_download"))
  expect(download.mock.calls[0]?.[0].diagnostic).toMatchObject({retry_mode:"until_cancelled",attempt:7,attempt_limit:null,total_budget_ms:null,remaining_budget_ms:null})
})
