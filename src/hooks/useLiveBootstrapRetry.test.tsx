import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ get: vi.fn(), postOnce: vi.fn(), stop: vi.fn(), fence: vi.fn() }))
vi.mock("@services/api", () => ({ apiClient: { get: mocks.get, postOnce: mocks.postOnce }, getBackendStorageScope: () => "https://fixture.test/api/v1" }))
vi.mock("@services/chat/AgentService", () => ({ agentClient: { stopGeneration: mocks.stop } }))
vi.mock("@/lib/continuousRetryFence", () => ({ readContinuousRetryFence: mocks.fence }))
import { useLiveBootstrapRetry } from "./useLiveBootstrapRetry"
import { ApiError } from "@services/api/errors"
import { readLiveBootstrapConfirmation } from "@services/chat/liveBootstrapRetry"
import { LiveBootstrapRetryNotice } from "@/components/chat/LiveBootstrapRetryNotice"
const capability = { upstream_retry: { supported_modes: ["bounded", "until_cancelled"] }, live_bootstrap_resume: {
  protocol_version: 1, offer_timeout_ms: 600000, waiting_endpoint: "execute/{session_id}/retry",
  continue_run_header: "Bamboo-Run-Id", initial_opt_in_field: "live_bootstrap_resume" } }
const waiting = (sessionId = "s", runId = "run-a", expires = 30000, confirming = false) =>
  ({ session_id: sessionId, run_id: runId, status: "retry_waiting", expires_in_ms: expires, confirming })
type Props = { sessionId: string | null; running: boolean; root: boolean }
type State = ReturnType<typeof useLiveBootstrapRetry>
let roots: Root[] = []
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function mount(initial: Props, display = false) {
  const container = document.createElement("div"); document.body.append(container)
  const root = createRoot(container); roots.push(root)
  let current!: State
  function Harness(props: Props) {
    current = useLiveBootstrapRetry(props.sessionId, props.running, props.root)
    return display ? <LiveBootstrapRetryNotice offer={current.offer} disabled={false}
      onConfirm={() => void current.confirm()} onStop={() => void current.stop()} /> : null
  }
  const render = async (props: Props) => { await act(async () => { root.render(<Harness {...props}/>); for(let i=0;i<8;i++) await Promise.resolve() }) }
  await render(initial)
  return { get current() { return current }, render, unmount() { act(() => root.unmount()); roots = roots.filter(x => x !== root); container.remove() } }
}
beforeAll(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }) })
beforeEach(() => {
  vi.useFakeTimers(); sessionStorage.clear(); localStorage.clear()
  mocks.get.mockReset().mockImplementation(async (path:string) => path === "execute/defaults" ? capability : waiting())
  mocks.postOnce.mockReset().mockResolvedValue({session_id:"s",run_id:"run-a",status:"retry_continuing"})
  mocks.stop.mockReset().mockResolvedValue(undefined)
  mocks.fence.mockReset().mockReturnValue({kind:"confirmed",runId:"run-a"})
})
afterEach(() => { for (const root of roots.splice(0)) act(() => root.unmount()); vi.useRealTimers(); document.body.replaceChildren() })

it("negotiates, observes and confirms only the same owned live run", async () => {
  const hook = await mount({sessionId:"s",running:true,root:true})
  expect(hook.current.canPrepare).toBe(true)
  expect(hook.current.offer?.status).toBe("waiting")
  await act(async () => { await hook.current.confirm() })
  expect(mocks.postOnce).toHaveBeenCalledExactlyOnceWith("execute/s", {upstream_retry:{mode:"until_cancelled"}}, {headers:{"Bamboo-Run-Id":"run-a"}})
  expect(hook.current.offer?.status).toBe("continued")
  await act(async () => { await hook.current.confirm() })
  expect(mocks.postOnce).toHaveBeenCalledTimes(1)
})
it("lets the user confirm and then Stop the same offered run through the visible controls", async () => {
  const hook = await mount({sessionId:"s",running:true,root:true}, true)
  const buttons = [...document.querySelectorAll("button")]
  expect(buttons).toHaveLength(2)
  await act(async () => { buttons[0]!.click(); for (let i=0;i<12;i++) await Promise.resolve() })
  expect(hook.current.offer?.status).toBe("continued")
  expect(mocks.postOnce).toHaveBeenCalledExactlyOnceWith("execute/s", {upstream_retry:{mode:"until_cancelled"}}, {headers:{"Bamboo-Run-Id":"run-a"}})
  const stop = [...document.querySelectorAll("button")]
  expect(stop).toHaveLength(1)
  await act(async () => { stop[0]!.click(); for (let i=0;i<12;i++) await Promise.resolve() })
  expect(mocks.stop).toHaveBeenCalledExactlyOnceWith("s","run-a")
  expect(hook.current.offer?.status).toBe("stop_requested")
})
it("waits briefly for an in-flight capability before the first submission", async () => {
  const initial = deferred<unknown>()
  mocks.get.mockReturnValue(initial.promise)
  const hook = await mount({sessionId:null,running:false,root:true})
  let decision!: boolean | Promise<boolean>
  act(() => { decision = hook.current.prepareInitial() })
  expect(decision).toBeInstanceOf(Promise)
  await act(async () => { initial.resolve(capability); await Promise.resolve() })
  await expect(decision).resolves.toBe(true)
})
it("does not hold normal submission indefinitely when capability is slow", async () => {
  mocks.get.mockReturnValue(new Promise(() => {}))
  const hook = await mount({sessionId:null,running:false,root:true})
  let decision!: boolean | Promise<boolean>
  act(() => { decision = hook.current.prepareInitial() })
  await act(async () => { await vi.advanceTimersByTimeAsync(750) })
  await expect(decision).resolves.toBe(false)
})
it("does not carry a delayed capability into a different session", async () => {
  const initial = deferred<unknown>(); mocks.get.mockReturnValue(initial.promise)
  const hook = await mount({sessionId:null,running:false,root:true})
  let decision!: boolean | Promise<boolean>
  act(() => { decision = hook.current.prepareInitial() })
  await hook.render({sessionId:"other",running:false,root:true})
  await act(async () => { initial.resolve(capability); await Promise.resolve() })
  await expect(decision).resolves.toBe(false)
})
it("does not opt in or poll when the capability is absent", async () => {
  mocks.get.mockResolvedValue({})
  const hook = await mount({sessionId:"s",running:true,root:true})
  expect(hook.current.canPrepare).toBe(false); expect(hook.current.offer).toBeNull()
  expect(mocks.get).toHaveBeenCalledExactlyOnceWith("execute/defaults", {cache:"no-store"})
  await act(async () => { await hook.current.confirm() }); expect(mocks.postOnce).not.toHaveBeenCalled()
})
it("does not opt in or poll for a child session", async () => {
  const hook = await mount({sessionId:"s",running:true,root:false})
  expect(hook.current.canPrepare).toBe(false); expect(hook.current.offer).toBeNull()
  expect(mocks.get.mock.calls.every(call => call[0] !== "execute/s/retry")).toBe(true)
})
it("does not borrow a different run identity for confirmation or Stop", async () => {
  mocks.fence.mockReturnValue({kind:"confirmed",runId:"other-run"})
  const hook = await mount({sessionId:"s",running:true,root:true})
  expect(hook.current.offer?.status).toBe("identity_unavailable")
  await act(async () => { await hook.current.confirm(); await hook.current.stop() })
  expect(mocks.postOnce).not.toHaveBeenCalled(); expect(mocks.stop).not.toHaveBeenCalled()
})
it("reports an expired offer and does not confirm", async () => {
  mocks.get.mockImplementation(async (path:string) => path === "execute/defaults" ? capability : waiting("s","run-a",0))
  const hook = await mount({sessionId:"s",running:true,root:true})
  expect(hook.current.offer?.status).toBe("expired")
  await act(async () => { await hook.current.confirm() }); expect(mocks.postOnce).not.toHaveBeenCalled()
})
it("expires a waiting offer as its displayed deadline elapses", async () => {
  mocks.get.mockImplementation(async (path:string) => path === "execute/defaults" ? capability : waiting("s", "run-a", 1000))
  const hook = await mount({sessionId:"s",running:true,root:true})
  expect(hook.current.offer?.status).toBe("waiting")
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(hook.current.offer?.status).toBe("expired")
  await act(async () => { await hook.current.confirm() })
  expect(mocks.postOnce).not.toHaveBeenCalled()
})
it("releases only its own pending confirmation for the exact producer refusal", async () => {
  const body = { session_id:"s", error:{type:"api_error", code:"retry_resume_not_prepared", message:"synthetic"} }
  mocks.postOnce.mockRejectedValue(new ApiError("conflict",409,"Conflict",JSON.stringify(body)))
  const hook = await mount({sessionId:"s",running:true,root:true})
  await act(async () => { await hook.current.confirm() })
  expect(hook.current.offer?.status).toBe("unavailable")
  expect(readLiveBootstrapConfirmation("s","run-a")).toBe("clear")
  expect(mocks.postOnce).toHaveBeenCalledTimes(1); expect(mocks.stop).not.toHaveBeenCalled()
})
it("does not confuse a changed retry state with the definite producer refusal", async () => {
  const body = { session_id:"s", error:{type:"api_error", code:"retry_state_changed", message:"synthetic"} }
  mocks.postOnce.mockRejectedValue(new ApiError("conflict",409,"Conflict",JSON.stringify(body)))
  const hook = await mount({sessionId:"s",running:true,root:true})
  await act(async () => { await hook.current.confirm() })
  expect(hook.current.offer?.status).toBe("unconfirmed")
  expect(readLiveBootstrapConfirmation("s","run-a")).toBe("pending")
  expect(mocks.postOnce).toHaveBeenCalledTimes(1); expect(mocks.stop).not.toHaveBeenCalled()
})
it("keeps a lost confirmation fenced after remount instead of repeating it", async () => {
  mocks.postOnce.mockRejectedValue(new Error("synthetic lost response"))
  const first = await mount({sessionId:"s",running:true,root:true})
  await act(async () => { await first.current.confirm() })
  expect(first.current.offer?.status).toBe("unconfirmed");expect(mocks.postOnce).toHaveBeenCalledTimes(1)
  first.unmount()
  const second = await mount({sessionId:"s",running:true,root:true})
  expect(second.current.offer?.status).toBe("unconfirmed")
  await act(async () => { await second.current.confirm() });expect(mocks.postOnce).toHaveBeenCalledTimes(1)
})
it("does not apply an old session's delayed observation after navigation", async () => {
  const old = deferred<unknown>()
  mocks.get.mockImplementation((path:string) => path === "execute/defaults" ? Promise.resolve(capability)
    : path === "execute/s/retry" ? old.promise : Promise.resolve(waiting("next","run-b")))
  const hook = await mount({sessionId:"s",running:true,root:true})
  mocks.fence.mockReturnValue({kind:"confirmed",runId:"run-b"})
  await hook.render({sessionId:"next",running:true,root:true})
  await act(async () => { old.resolve(waiting()); for(let i=0;i<8;i++) await Promise.resolve() })
  expect(hook.current.offer?.sessionId).toBe("next")
  expect(hook.current.offer?.runId).toBe("run-b")
  expect(mocks.postOnce).not.toHaveBeenCalled()
})
it("Stop fences a pending confirmation and targets the exact offered run", async () => {
  const recheck = deferred<unknown>(); let reads = 0
  mocks.get.mockImplementation((path:string) => path === "execute/defaults" ? Promise.resolve(capability)
    : ++reads === 1 ? Promise.resolve(waiting()) : recheck.promise)
  const hook = await mount({sessionId:"s",running:true,root:true})
  let confirm!: Promise<void>
  await act(async () => { confirm = hook.current.confirm(); await Promise.resolve() })
  await act(async () => { await hook.current.stop() })
  await act(async () => { recheck.resolve(waiting()); await confirm })
  expect(mocks.stop).toHaveBeenCalledExactlyOnceWith("s","run-a")
  expect(mocks.postOnce).not.toHaveBeenCalled()
  expect(hook.current.offer?.status).toBe("stop_requested")
})
it("does not confirm if live capability was withdrawn after the offer appeared", async () => {
  let capabilities = 0
  mocks.get.mockImplementation(async (path:string) => path === "execute/defaults" ? ++capabilities === 1 ? capability : {} : waiting())
  const hook = await mount({sessionId:"s",running:true,root:true})
  expect(hook.current.offer?.status).toBe("waiting")
  await act(async () => { await hook.current.confirm() })
  expect(mocks.postOnce).not.toHaveBeenCalled()
  expect(hook.current.offer?.status).toBe("unavailable")
})
it("does not send Stop if live capability was withdrawn after the offer appeared", async () => {
  let capabilities = 0
  mocks.get.mockImplementation(async (path:string) => path === "execute/defaults" ? ++capabilities === 1 ? capability : {} : waiting())
  const hook = await mount({sessionId:"s",running:true,root:true})
  await act(async () => { await hook.current.stop() })
  expect(mocks.stop).not.toHaveBeenCalled()
  expect(hook.current.offer?.status).toBe("stop_unconfirmed")
})
it("rechecks the owned run after capability negotiation before Stop", async () => {
  const later = deferred<unknown>(); let capabilities = 0
  mocks.get.mockImplementation((path:string) => path === "execute/defaults" ? ++capabilities === 1 ? Promise.resolve(capability) : later.promise : Promise.resolve(waiting()))
  const hook = await mount({sessionId:"s",running:true,root:true}); let stopping!: Promise<void>
  await act(async () => { stopping = hook.current.stop(); await Promise.resolve() })
  mocks.fence.mockReturnValue({kind:"confirmed",runId:"new-run"})
  await act(async () => { later.resolve(capability); await stopping })
  expect(mocks.stop).not.toHaveBeenCalled()
  expect(hook.current.offer).toBeNull()
})
it("does not confirm after the originating pane unmounts during the offer recheck", async () => {
  const later = deferred<unknown>(); let reads = 0
  mocks.get.mockImplementation((path:string) => path === "execute/defaults" ? Promise.resolve(capability)
    : ++reads === 1 ? Promise.resolve(waiting()) : later.promise)
  const hook = await mount({sessionId:"s",running:true,root:true}); let request!: Promise<void>
  await act(async () => { request = hook.current.confirm(); for(let i=0;i<8;i++) await Promise.resolve() })
  hook.unmount()
  await act(async () => { later.resolve(waiting()); await request })
  expect(mocks.postOnce).not.toHaveBeenCalled()
})
it("does not send Stop after unmount during capability recheck", async () => {
  const later = deferred<unknown>(); let capabilities = 0
  mocks.get.mockImplementation((path:string) => path === "execute/defaults" ? ++capabilities === 1 ? Promise.resolve(capability) : later.promise : Promise.resolve(waiting()))
  const hook = await mount({sessionId:"s",running:true,root:true}); let stopping!: Promise<void>
  await act(async () => { stopping = hook.current.stop(); await Promise.resolve() })
  hook.unmount()
  await act(async () => { later.resolve(capability); await stopping })
  expect(mocks.stop).not.toHaveBeenCalled()
})
it("does not confirm an offer that another client is already confirming", async () => {
  mocks.get.mockImplementation(async (path:string) => path === "execute/defaults" ? capability : waiting("s","run-a",30000,true))
  const hook = await mount({sessionId:"s",running:true,root:true})
  expect(hook.current.offer?.status).toBe("confirming")
  await act(async () => { await hook.current.confirm() });expect(mocks.postOnce).not.toHaveBeenCalled()
})


it.each(["accepted", "refused", "unknown"] as const)("same-session successor stays confirmed when an older result is %s", async (outcome) => {
  let offered = "run-a"
  const first = deferred<unknown>()
  mocks.get.mockImplementation(async (path:string) => path === "execute/defaults" ? capability : waiting("s",offered))
  mocks.fence.mockImplementation(() => ({kind:"confirmed",runId:offered}))
  mocks.postOnce.mockImplementation((_path:string, _body:unknown, options:{headers:{"Bamboo-Run-Id":string}}) =>
    options.headers["Bamboo-Run-Id"] === "run-a" ? first.promise : Promise.resolve({session_id:"s",run_id:"run-b",status:"retry_continuing"}))
  const hook = await mount({sessionId:"s",running:true,root:true})
  let oldRequest!: Promise<void>
  await act(async () => { oldRequest = hook.current.confirm(); for (let i=0;i<12;i++) await Promise.resolve() })
  expect(mocks.postOnce).toHaveBeenCalledTimes(1)
  offered = "run-b"
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(hook.current.offer).toMatchObject({runId:"run-b",status:"waiting"})
  await act(async () => { await hook.current.confirm() })
  expect(mocks.postOnce).toHaveBeenCalledTimes(2)
  expect(hook.current.offer).toMatchObject({runId:"run-b",status:"continued"})
  await act(async () => {
    if (outcome === "accepted") first.resolve({session_id:"s",run_id:"run-a",status:"retry_continuing"})
    else if (outcome === "refused") first.reject(new ApiError("conflict",409,"Conflict",JSON.stringify({session_id:"s",error:{code:"retry_resume_not_prepared"}})))
    else first.reject(new Error("synthetic unknown outcome"))
    await oldRequest
  })
  expect(hook.current.offer).toMatchObject({runId:"run-b",status:"continued"})
  expect(readLiveBootstrapConfirmation("s","run-b")).toBe("accepted")
})

it("a late acknowledgement cannot replace a same-session successor offer", async () => {
  let offered = "run-a"
  const first = deferred<unknown>()
  mocks.get.mockImplementation(async (path:string) => path === "execute/defaults" ? capability : waiting("s",offered))
  mocks.fence.mockImplementation(() => ({kind:"confirmed",runId:offered}))
  mocks.postOnce.mockReturnValue(first.promise)
  const hook = await mount({sessionId:"s",running:true,root:true})
  let oldRequest!: Promise<void>
  await act(async () => { oldRequest = hook.current.confirm(); for (let i=0;i<12;i++) await Promise.resolve() })
  offered = "run-b"
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(hook.current.offer).toMatchObject({runId:"run-b",status:"waiting"})
  await act(async () => { first.resolve({session_id:"s",run_id:"run-a",status:"retry_continuing"}); await oldRequest })
  expect(hook.current.offer).toMatchObject({runId:"run-b",status:"waiting"})
})

it("renegotiates the live capability after an initial transient failure", async () => {
  let calls = 0
  mocks.get.mockImplementation(async (path:string) => {
    if (path !== "execute/defaults") return waiting()
    if (++calls === 1) throw new Error("temporary network failure")
    return capability
  })
  const hook = await mount({sessionId:null,running:false,root:true})
  expect(hook.current.canPrepare).toBe(false)
  let next!: boolean | Promise<boolean>
  await act(async () => { next = hook.current.prepareInitial(); for (let i=0;i<12;i++) await Promise.resolve() })
  expect(await next).toBe(true)
  expect(calls).toBe(2)
})


it("shares a recovered capability request across concurrent submissions", async () => {
  let calls = 0
  const recovery = deferred<unknown>()
  mocks.get.mockImplementation((path:string) => {
    if (path !== "execute/defaults") return Promise.resolve(waiting())
    return ++calls === 1 ? Promise.reject(new Error("temporary network failure")) : recovery.promise
  })
  const hook = await mount({sessionId:null,running:false,root:true})
  let first!: boolean | Promise<boolean>, second!: boolean | Promise<boolean>
  act(() => { first = hook.current.prepareInitial(); second = hook.current.prepareInitial() })
  expect(calls).toBe(2)
  await act(async () => { recovery.resolve(capability); for (let i=0;i<8;i++) await Promise.resolve() })
  await expect(first).resolves.toBe(true)
  await expect(second).resolves.toBe(true)
})

it("does not apply a recovered capability decision to a different session", async () => {
  let calls = 0
  const recovery = deferred<unknown>()
  mocks.get.mockImplementation((path:string) => {
    if (path !== "execute/defaults") return Promise.resolve(waiting())
    return ++calls === 1 ? Promise.reject(new Error("temporary network failure")) : recovery.promise
  })
  const hook = await mount({sessionId:null,running:false,root:true})
  let decision!: boolean | Promise<boolean>
  act(() => { decision = hook.current.prepareInitial() })
  await hook.render({sessionId:"other",running:false,root:true})
  await act(async () => { recovery.resolve(capability); for (let i=0;i<8;i++) await Promise.resolve() })
  await expect(decision).resolves.toBe(false)
})


it.each(["acknowledged", "unknown"] as const)("late Stop result cannot overwrite a confirmed successor when %s", async (outcome) => {
  let offered = "run-a"
  const oldStop = deferred<void>()
  mocks.get.mockImplementation(async (path:string) => path === "execute/defaults" ? capability : waiting("s",offered))
  mocks.fence.mockImplementation(() => ({kind:"confirmed",runId:offered}))
  mocks.stop.mockReturnValue(oldStop.promise)
  mocks.postOnce.mockResolvedValue({session_id:"s",run_id:"run-b",status:"retry_continuing"})
  const hook = await mount({sessionId:"s",running:true,root:true})
  let stopping!: Promise<void>
  await act(async () => { stopping = hook.current.stop(); for (let i=0;i<12;i++) await Promise.resolve() })
  expect(mocks.stop).toHaveBeenCalledExactlyOnceWith("s","run-a")
  offered = "run-b"
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(hook.current.offer).toMatchObject({runId:"run-b",status:"waiting"})
  await act(async () => { await hook.current.confirm() })
  expect(hook.current.offer).toMatchObject({runId:"run-b",status:"continued"})
  await act(async () => {
    if (outcome === "acknowledged") oldStop.resolve()
    else oldStop.reject(new Error("synthetic lost Stop response"))
    await stopping
  })
  expect(hook.current.offer).toMatchObject({runId:"run-b",status:"continued"})
  expect(mocks.stop).toHaveBeenCalledTimes(1)
})


it.each(["confirmation", "stop"] as const)("clears stale %s feedback when successor identity changes before the pane observes it", async (kind) => {
  let currentRun = "run-a", unavailable = false
  const pending = deferred<unknown>()
  mocks.get.mockImplementation(async (path:string) => path === "execute/defaults" ? capability
    : unavailable ? {session_id:"s",status:"unavailable"} : waiting("s","run-a"))
  mocks.fence.mockImplementation(() => ({kind:"confirmed",runId:currentRun}))
  if (kind === "confirmation") mocks.postOnce.mockReturnValue(pending.promise)
  else mocks.stop.mockReturnValue(pending.promise)
  const hook = await mount({sessionId:"s",running:true,root:true})
  let oldAction!: Promise<void>
  await act(async () => { oldAction = kind === "confirmation" ? hook.current.confirm() : hook.current.stop(); for (let i=0;i<12;i++) await Promise.resolve() })
  expect(kind === "confirmation" ? mocks.postOnce : mocks.stop).toHaveBeenCalledTimes(1)
  currentRun = "run-b"
  unavailable = true
  await act(async () => {
    pending.resolve(kind === "confirmation" ? {session_id:"s",run_id:"run-a",status:"retry_continuing"} : undefined)
    await oldAction
  })
  expect(hook.current.offer).toBeNull()
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(hook.current.offer).toBeNull()
})


it.each(["confirmation", "stop"] as const)("does not claim a %s result when the run identity becomes unreadable", async (kind) => {
  const pending = deferred<unknown>()
  if (kind === "confirmation") mocks.postOnce.mockReturnValue(pending.promise)
  else mocks.stop.mockReturnValue(pending.promise)
  const hook = await mount({sessionId:"s",running:true,root:true})
  let oldAction!: Promise<void>
  await act(async () => { oldAction = kind === "confirmation" ? hook.current.confirm() : hook.current.stop(); for (let i=0;i<12;i++) await Promise.resolve() })
  mocks.fence.mockReturnValue({kind:"unavailable"})
  await act(async () => {
    pending.resolve(kind === "confirmation" ? {session_id:"s",run_id:"run-a",status:"retry_continuing"} : undefined)
    await oldAction
  })
  expect(hook.current.offer).toMatchObject({runId:"run-a",status:"identity_unavailable"})
})
