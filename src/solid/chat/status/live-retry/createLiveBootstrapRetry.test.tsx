import { createSignal, flush } from "solid-js"
import { render } from "@solidjs/web"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { uiText } from "@shared/i18n/text"
import { ApiError } from "@services/api/errors"
import { readLiveBootstrapConfirmation } from "@services/chat/liveBootstrapRetry"

import { createLiveBootstrapRetry } from "./createLiveBootstrapRetry"
import { LiveBootstrapRetryNotice } from "./LiveBootstrapRetryNotice"

const mocks = vi.hoisted(() => ({ get: vi.fn(), postOnce: vi.fn(), stop: vi.fn(), fence: vi.fn() }))
vi.mock("@services/api", () => ({
  apiClient: { get: mocks.get, postOnce: mocks.postOnce }, getBackendStorageScope: () => "https://fixture.test/api/v1",
}))
vi.mock("@services/chat/AgentService", () => ({ agentClient: { stopGeneration: mocks.stop } }))
vi.mock("@/lib/continuousRetryFence", () => ({ readContinuousRetryFence: mocks.fence }))

const capability = { upstream_retry: { supported_modes: ["bounded", "until_cancelled"] }, live_bootstrap_resume: {
  protocol_version: 1, offer_timeout_ms: 600000, waiting_endpoint: "execute/{session_id}/retry",
  continue_run_header: "Bamboo-Run-Id", initial_opt_in_field: "live_bootstrap_resume" } }
const waiting = (sessionId = "s", runId = "run-a", expires = 30000, confirming = false) =>
  ({ session_id: sessionId, run_id: runId, status: "retry_waiting", expires_in_ms: expires, confirming })
type Props = { sessionId: string | null; running: boolean; root: boolean }
const owners = new Set<() => void>()

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

async function applyChanges(change: () => void | Promise<void>) {
  const completion = change()
  flush()
  await completion
  // Drain the capability/offer promise chain and publish the Solid effects.
  for (let pass = 0; pass < 12; pass += 1) {
    await Promise.resolve()
    flush()
  }
}

async function mount(initial: Props, display = false) {
  const container = document.body.appendChild(document.createElement("div"))
  const [props, update] = createSignal(initial)
  let current!: ReturnType<typeof createLiveBootstrapRetry>
  const dispose = render(() => {
    current = createLiveBootstrapRetry({ sessionId: () => props().sessionId, running: () => props().running, root: () => props().root })
    return display ? <LiveBootstrapRetryNotice offer={current.offer} disabled={false}
      onConfirm={() => void current.confirm()} onStop={() => void current.stop()} onRefresh={() => void current.refresh()} /> : null
  }, container)
  const unmount = () => {
    if (!owners.delete(unmount)) return
    dispose()
    container.remove()
    flush()
  }
  owners.add(unmount)
  await applyChanges(() => {})
  return { current, render: (next: Props) => applyChanges(() => { update(next) }), unmount }
}

beforeEach(() => {
  vi.useFakeTimers()
  sessionStorage.clear()
  localStorage.clear()
  mocks.get.mockReset().mockImplementation(async (path: string) => path === "execute/defaults" ? capability : waiting())
  mocks.postOnce.mockReset().mockResolvedValue({ session_id: "s", run_id: "run-a", status: "retry_continuing" })
  mocks.stop.mockReset().mockResolvedValue(undefined)
  mocks.fence.mockReset().mockReturnValue({ kind: "confirmed", runId: "run-a" })
})
afterEach(() => {
  for (const unmount of [...owners]) unmount()
  vi.useRealTimers()
})

it("negotiates, observes and confirms only the same owned live run", async () => {
  const hook = await mount({sessionId:"s",running:true,root:true})
  expect(hook.current.canPrepare).toBe(true)
  expect(hook.current.offer?.status).toBe("waiting")
  await applyChanges(hook.current.confirm)
  expect(mocks.postOnce).toHaveBeenCalledExactlyOnceWith("execute/s", {upstream_retry:{mode:"until_cancelled"}}, {headers:{"Bamboo-Run-Id":"run-a"}})
  expect(hook.current.offer?.status).toBe("continued")
  await applyChanges(hook.current.confirm)
  expect(mocks.postOnce).toHaveBeenCalledTimes(1)
})
it("lets the user confirm and then Stop the same offered run through the visible controls", async () => {
  const hook = await mount({sessionId:"s",running:true,root:true}, true)
  const buttons = [...document.querySelectorAll("button")]
  expect(buttons).toHaveLength(2)
  await applyChanges(() => { buttons[0]!.click() })
  expect(hook.current.offer?.status).toBe("continued")
  expect(mocks.postOnce).toHaveBeenCalledExactlyOnceWith("execute/s", {upstream_retry:{mode:"until_cancelled"}}, {headers:{"Bamboo-Run-Id":"run-a"}})
  const stop = [...document.querySelectorAll("button")]
  expect(stop).toHaveLength(1)
  await applyChanges(() => { stop[0]!.click() })
  expect(mocks.stop).toHaveBeenCalledExactlyOnceWith("s","run-a")
  expect(hook.current.offer?.status).toBe("stop_requested")
})
it("waits briefly for an in-flight capability before the first submission", async () => {
  const initial = deferred<unknown>()
  mocks.get.mockReturnValue(initial.promise)
  const hook = await mount({sessionId:null,running:false,root:true})
  let decision!: boolean | Promise<boolean>
  await applyChanges(() => { decision = hook.current.prepareInitial() })
  expect(decision).toBeInstanceOf(Promise)
  await applyChanges(() => { initial.resolve(capability) })
  await expect(decision).resolves.toBe(true)
})
it("does not hold normal submission indefinitely when capability is slow", async () => {
  mocks.get.mockReturnValue(new Promise(() => {}))
  const hook = await mount({sessionId:null,running:false,root:true})
  let decision!: boolean | Promise<boolean>
  await applyChanges(() => { decision = hook.current.prepareInitial() })
  await applyChanges(async () => { await vi.advanceTimersByTimeAsync(750) })
  await expect(decision).resolves.toBe(false)
})
it("does not carry a delayed capability into a different session", async () => {
  const initial = deferred<unknown>(); mocks.get.mockReturnValue(initial.promise)
  const hook = await mount({sessionId:null,running:false,root:true})
  let decision!: boolean | Promise<boolean>
  await applyChanges(() => { decision = hook.current.prepareInitial() })
  await hook.render({sessionId:"other",running:false,root:true})
  await applyChanges(() => { initial.resolve(capability) })
  await expect(decision).resolves.toBe(false)
})
it("does not opt in or poll when the capability is absent", async () => {
  mocks.get.mockResolvedValue({})
  const hook = await mount({sessionId:"s",running:true,root:true}, true)
  expect(hook.current.canPrepare).toBe(false); expect(hook.current.offer).toBeNull()
  expect(mocks.get).toHaveBeenCalledExactlyOnceWith("execute/defaults", {cache:"no-store"})
  expect(document.querySelector("button")).toBeNull()
  expect(document.body.textContent).toBe("")
  await applyChanges(hook.current.confirm); expect(mocks.postOnce).not.toHaveBeenCalled()
})
it("keeps capability loading and a failed capability read silent without retrying the run", async () => {
  const response = deferred<unknown>()
  mocks.get.mockReturnValue(response.promise)
  const hook = await mount({sessionId:"s",running:true,root:true}, true)
  expect(document.body.textContent).toBe("")
  expect(document.querySelector("button")).toBeNull()
  await applyChanges(() => response.reject(new Error("Private capability read detail")))
  expect(hook.current.offer).toBeNull()
  expect(document.body.textContent).toBe("")
  expect(document.querySelector("button")).toBeNull()
  await applyChanges(hook.current.confirm)
  expect(mocks.postOnce).not.toHaveBeenCalled()
  expect(mocks.stop).not.toHaveBeenCalled()
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
  await applyChanges(async () => { await hook.current.confirm(); await hook.current.stop() })
  expect(mocks.postOnce).not.toHaveBeenCalled(); expect(mocks.stop).not.toHaveBeenCalled()
})
it("reports an expired offer and does not confirm", async () => {
  mocks.get.mockImplementation(async (path:string) => path === "execute/defaults" ? capability : waiting("s","run-a",0))
  const hook = await mount({sessionId:"s",running:true,root:true})
  expect(hook.current.offer?.status).toBe("expired")
  await applyChanges(hook.current.confirm); expect(mocks.postOnce).not.toHaveBeenCalled()
})
it("expires a waiting offer as its displayed deadline elapses", async () => {
  mocks.get.mockImplementation(async (path:string) => path === "execute/defaults" ? capability : waiting("s", "run-a", 1000))
  const hook = await mount({sessionId:"s",running:true,root:true})
  expect(hook.current.offer?.status).toBe("waiting")
  await applyChanges(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(hook.current.offer?.status).toBe("expired")
  await applyChanges(hook.current.confirm)
  expect(mocks.postOnce).not.toHaveBeenCalled()
})
it("releases only its own pending confirmation for the exact producer refusal", async () => {
  const body = { session_id:"s", error:{type:"api_error", code:"retry_resume_not_prepared", message:"synthetic"} }
  mocks.postOnce.mockRejectedValue(new ApiError("conflict",409,"Conflict",JSON.stringify(body)))
  const hook = await mount({sessionId:"s",running:true,root:true})
  await applyChanges(hook.current.confirm)
  expect(hook.current.offer?.status).toBe("unavailable")
  expect(readLiveBootstrapConfirmation("s","run-a")).toBe("clear")
  expect(mocks.postOnce).toHaveBeenCalledTimes(1); expect(mocks.stop).not.toHaveBeenCalled()
})
it("does not confuse a changed retry state with the definite producer refusal", async () => {
  const body = { session_id:"s", error:{type:"api_error", code:"retry_state_changed", message:"synthetic"} }
  mocks.postOnce.mockRejectedValue(new ApiError("conflict",409,"Conflict",JSON.stringify(body)))
  const hook = await mount({sessionId:"s",running:true,root:true})
  await applyChanges(hook.current.confirm)
  expect(hook.current.offer?.status).toBe("unconfirmed")
  expect(readLiveBootstrapConfirmation("s","run-a")).toBe("pending")
  expect(mocks.postOnce).toHaveBeenCalledTimes(1); expect(mocks.stop).not.toHaveBeenCalled()
})
it("keeps a lost confirmation fenced after remount instead of repeating it", async () => {
  mocks.postOnce.mockRejectedValue(new Error("synthetic lost response"))
  const first = await mount({sessionId:"s",running:true,root:true})
  await applyChanges(first.current.confirm)
  expect(first.current.offer?.status).toBe("unconfirmed");expect(mocks.postOnce).toHaveBeenCalledTimes(1)
  first.unmount()
  const second = await mount({sessionId:"s",running:true,root:true})
  expect(second.current.offer?.status).toBe("unconfirmed")
  await applyChanges(second.current.confirm);expect(mocks.postOnce).toHaveBeenCalledTimes(1)
})
it("does not apply an old session's delayed observation after navigation", async () => {
  const old = deferred<unknown>()
  mocks.get.mockImplementation((path:string) => path === "execute/defaults" ? Promise.resolve(capability)
    : path === "execute/s/retry" ? old.promise : Promise.resolve(waiting("next","run-b")))
  const hook = await mount({sessionId:"s",running:true,root:true})
  mocks.fence.mockReturnValue({kind:"confirmed",runId:"run-b"})
  await hook.render({sessionId:"next",running:true,root:true})
  await applyChanges(() => { old.resolve(waiting()) })
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
  await applyChanges(() => { confirm = hook.current.confirm() })
  await applyChanges(hook.current.stop)
  await applyChanges(async () => { recheck.resolve(waiting()); await confirm })
  expect(mocks.stop).toHaveBeenCalledExactlyOnceWith("s","run-a")
  expect(mocks.postOnce).not.toHaveBeenCalled()
  expect(hook.current.offer?.status).toBe("stop_requested")
})
it("does not confirm if live capability was withdrawn after the offer appeared", async () => {
  let capabilities = 0
  mocks.get.mockImplementation(async (path:string) => path === "execute/defaults" ? ++capabilities === 1 ? capability : {} : waiting())
  const hook = await mount({sessionId:"s",running:true,root:true})
  expect(hook.current.offer?.status).toBe("waiting")
  await applyChanges(hook.current.confirm)
  expect(mocks.postOnce).not.toHaveBeenCalled()
  expect(hook.current.offer?.status).toBe("unavailable")
})
it("does not send Stop if live capability was withdrawn after the offer appeared", async () => {
  let capabilities = 0
  mocks.get.mockImplementation(async (path:string) => path === "execute/defaults" ? ++capabilities === 1 ? capability : {} : waiting())
  const hook = await mount({sessionId:"s",running:true,root:true})
  await applyChanges(hook.current.stop)
  expect(mocks.stop).not.toHaveBeenCalled()
  expect(hook.current.offer?.status).toBe("stop_unconfirmed")
})
it("rechecks the owned run after capability negotiation before Stop", async () => {
  const later = deferred<unknown>(); let capabilities = 0
  mocks.get.mockImplementation((path:string) => path === "execute/defaults" ? ++capabilities === 1 ? Promise.resolve(capability) : later.promise : Promise.resolve(waiting()))
  const hook = await mount({sessionId:"s",running:true,root:true}); let stopping!: Promise<void>
  await applyChanges(() => { stopping = hook.current.stop() })
  mocks.fence.mockReturnValue({kind:"confirmed",runId:"new-run"})
  await applyChanges(async () => { later.resolve(capability); await stopping })
  expect(mocks.stop).not.toHaveBeenCalled()
  expect(hook.current.offer).toBeNull()
})
it("does not confirm after the originating pane unmounts during the offer recheck", async () => {
  const later = deferred<unknown>(); let reads = 0
  mocks.get.mockImplementation((path:string) => path === "execute/defaults" ? Promise.resolve(capability)
    : ++reads === 1 ? Promise.resolve(waiting()) : later.promise)
  const hook = await mount({sessionId:"s",running:true,root:true}); let request!: Promise<void>
  await applyChanges(() => { request = hook.current.confirm() })
  hook.unmount()
  await applyChanges(async () => { later.resolve(waiting()); await request })
  expect(mocks.postOnce).not.toHaveBeenCalled()
})
it("does not send Stop after unmount during capability recheck", async () => {
  const later = deferred<unknown>(); let capabilities = 0
  mocks.get.mockImplementation((path:string) => path === "execute/defaults" ? ++capabilities === 1 ? Promise.resolve(capability) : later.promise : Promise.resolve(waiting()))
  const hook = await mount({sessionId:"s",running:true,root:true}); let stopping!: Promise<void>
  await applyChanges(() => { stopping = hook.current.stop() })
  hook.unmount()
  await applyChanges(async () => { later.resolve(capability); await stopping })
  expect(mocks.stop).not.toHaveBeenCalled()
})
it("does not confirm an offer that another client is already confirming", async () => {
  mocks.get.mockImplementation(async (path:string) => path === "execute/defaults" ? capability : waiting("s","run-a",30000,true))
  const hook = await mount({sessionId:"s",running:true,root:true})
  expect(hook.current.offer?.status).toBe("confirming")
  await applyChanges(hook.current.confirm);expect(mocks.postOnce).not.toHaveBeenCalled()
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
  await applyChanges(() => { oldRequest = hook.current.confirm() })
  expect(mocks.postOnce).toHaveBeenCalledTimes(1)
  offered = "run-b"
  await applyChanges(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(hook.current.offer).toMatchObject({runId:"run-b",status:"waiting"})
  await applyChanges(hook.current.confirm)
  expect(mocks.postOnce).toHaveBeenCalledTimes(2)
  expect(hook.current.offer).toMatchObject({runId:"run-b",status:"continued"})
  await applyChanges(async () => {
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
  await applyChanges(() => { oldRequest = hook.current.confirm() })
  offered = "run-b"
  await applyChanges(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(hook.current.offer).toMatchObject({runId:"run-b",status:"waiting"})
  await applyChanges(async () => { first.resolve({session_id:"s",run_id:"run-a",status:"retry_continuing"}); await oldRequest })
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
  await applyChanges(() => { next = hook.current.prepareInitial() })
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
  await applyChanges(() => { first = hook.current.prepareInitial(); second = hook.current.prepareInitial() })
  expect(calls).toBe(2)
  await applyChanges(() => { recovery.resolve(capability) })
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
  await applyChanges(() => { decision = hook.current.prepareInitial() })
  await hook.render({sessionId:"other",running:false,root:true})
  await applyChanges(() => { recovery.resolve(capability) })
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
  await applyChanges(() => { stopping = hook.current.stop() })
  expect(mocks.stop).toHaveBeenCalledExactlyOnceWith("s","run-a")
  offered = "run-b"
  await applyChanges(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(hook.current.offer).toMatchObject({runId:"run-b",status:"waiting"})
  await applyChanges(hook.current.confirm)
  expect(hook.current.offer).toMatchObject({runId:"run-b",status:"continued"})
  await applyChanges(async () => {
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
  await applyChanges(() => { oldAction = kind === "confirmation" ? hook.current.confirm() : hook.current.stop() })
  expect(kind === "confirmation" ? mocks.postOnce : mocks.stop).toHaveBeenCalledTimes(1)
  currentRun = "run-b"
  unavailable = true
  await applyChanges(async () => {
    pending.resolve(kind === "confirmation" ? {session_id:"s",run_id:"run-a",status:"retry_continuing"} : undefined)
    await oldAction
  })
  expect(hook.current.offer).toBeNull()
  await applyChanges(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(hook.current.offer).toBeNull()
})


it.each(["confirmation", "stop"] as const)("does not claim a %s result when the run identity becomes unreadable", async (kind) => {
  const pending = deferred<unknown>()
  if (kind === "confirmation") mocks.postOnce.mockReturnValue(pending.promise)
  else mocks.stop.mockReturnValue(pending.promise)
  const hook = await mount({sessionId:"s",running:true,root:true})
  let oldAction!: Promise<void>
  await applyChanges(() => { oldAction = kind === "confirmation" ? hook.current.confirm() : hook.current.stop() })
  mocks.fence.mockReturnValue({kind:"unavailable"})
  await applyChanges(async () => {
    pending.resolve(kind === "confirmation" ? {session_id:"s",run_id:"run-a",status:"retry_continuing"} : undefined)
    await oldAction
  })
  expect(hook.current.offer).toMatchObject({runId:"run-a",status:"identity_unavailable"})
})

it("retries the exact Stop once with the rotated run identity after the first Stop is refused", async () => {
  let retryReads = 0
  mocks.get.mockImplementation(async (path:string) => path === "execute/defaults" ? capability
    : ++retryReads === 1 ? waiting("s","run-a") : waiting("s","run-b"))
  // The fence confirms whichever identity the backend currently offers.
  mocks.fence.mockImplementation(() => ({kind:"confirmed",runId: retryReads === 1 ? "run-a" : "run-b"}))
  // The server rotated its cancellable owner: the first exact Stop is refused (409).
  mocks.stop.mockRejectedValueOnce(new Error("409 Requested run is not the current cancellable owner"))
  const hook = await mount({sessionId:"s",running:true,root:true})
  await applyChanges(hook.current.stop)
  // Re-observation sees the successor run; the fence confirms it and the exact Stop retries once.
  expect(mocks.stop).toHaveBeenCalledTimes(2)
  expect(mocks.stop).toHaveBeenNthCalledWith(1, "s", "run-a")
  expect(mocks.stop).toHaveBeenNthCalledWith(2, "s", "run-b")
  expect(hook.current.offer).toMatchObject({runId:"run-b",status:"stop_requested"})
  // The adopted identity is stop-fenced: a later poll of the still-offered
  // successor must not resurrect actions over the recovered stop state.
  await applyChanges(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(hook.current.offer).toMatchObject({runId:"run-b",status:"stop_requested"})
})

it("discards a pending Refresh response after the pane switches sessions", async () => {
  const pending = deferred<unknown>()
  let reads = 0
  mocks.get.mockImplementation((path:string) => path === "execute/defaults" ? Promise.resolve(capability)
    : ++reads === 1 ? Promise.resolve(waiting("s","run-a")) : pending.promise)
  const hook = await mount({sessionId:"s",running:true,root:true})
  expect(hook.current.offer).toMatchObject({runId:"run-a",status:"waiting"})
  mocks.fence.mockReturnValue({kind:"confirmed",runId:"run-next"})
  let refreshing!: Promise<void>
  await applyChanges(() => { refreshing = hook.current.refresh() })
  await hook.render({sessionId:"next",running:true,root:true})
  // The stale session's "unavailable" response must not clear the new session's view.
  await applyChanges(async () => { pending.resolve({session_id:"s",status:"unavailable"}); await refreshing })
  expect(hook.current.offer).toBeNull()
  expect(reads).toBeGreaterThanOrEqual(2)
})

it("keeps an in-flight Stop settlement when a concurrent Refresh observes the same offer", async () => {
  const stopPending = deferred<void>()
  mocks.stop.mockReturnValue(stopPending.promise)
  const hook = await mount({sessionId:"s",running:true,root:true})
  let stopping!: Promise<void>
  await applyChanges(() => { stopping = hook.current.stop() })
  expect(mocks.stop).toHaveBeenCalledExactlyOnceWith("s","run-a")
  // Refresh runs while the exact Stop response is still pending.
  await applyChanges(hook.current.refresh)
  await applyChanges(async () => { stopPending.resolve(); await stopping })
  expect(hook.current.offer).toMatchObject({runId:"run-a",status:"stop_requested"})
})

it("a poll during the pending recovered Stop neither clears the action nor resurrects actions", async () => {
  let retryReads = 0
  const recoveredStop = deferred<void>()
  mocks.get.mockImplementation(async (path:string) => path === "execute/defaults" ? capability
    : ++retryReads === 1 ? waiting("s","run-a") : waiting("s","run-b"))
  mocks.fence.mockImplementation(() => ({kind:"confirmed",runId: retryReads === 1 ? "run-a" : "run-b"}))
  mocks.stop.mockImplementation(async (_sid: string, runId: string) => {
    if (runId === "run-a") throw new Error("409 Requested run is not the current cancellable owner")
    return recoveredStop.promise
  })
  const hook = await mount({sessionId:"s",running:true,root:true})
  let stopping!: Promise<void>
  await applyChanges(() => { stopping = hook.current.stop() })
  expect(mocks.stop).toHaveBeenNthCalledWith(1, "s", "run-a")
  expect(mocks.stop).toHaveBeenNthCalledWith(2, "s", "run-b")
  // The recovered Stop is pending; a five-second poll must not clear its
  // ownership or publish an actionable view for the still-offered successor.
  await applyChanges(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(hook.current.offer?.status).not.toBe("waiting")
  await applyChanges(async () => { recoveredStop.resolve(); await stopping })
  expect(hook.current.offer).toMatchObject({runId:"run-b",status:"stop_requested"})
  await applyChanges(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(hook.current.offer).toMatchObject({runId:"run-b",status:"stop_requested"})
})

it("Refresh re-offers the same fence-confirmed run after both Stop attempts failed transiently", async () => {
  mocks.stop.mockRejectedValue(new Error("network unreachable"))
  const hook = await mount({sessionId:"s",running:true,root:true}, true)
  await applyChanges(hook.current.stop)
  // First attempt + recovery retry both failed without reaching the server.
  expect(mocks.stop).toHaveBeenCalledTimes(2)
  expect(hook.current.offer).toMatchObject({runId:"run-a",status:"stop_unconfirmed"})
  // Once connectivity recovers, Refresh observes the same still-waiting run and
  // re-offers an exact Stop for it instead of dead-ending on the stale fence.
  await applyChanges(hook.current.refresh)
  expect(hook.current.offer).toMatchObject({runId:"run-a",status:"waiting"})
  mocks.stop.mockClear(); mocks.stop.mockResolvedValue(undefined)
  await applyChanges(hook.current.stop)
  expect(mocks.stop).toHaveBeenCalledExactlyOnceWith("s","run-a")
  expect(hook.current.offer).toMatchObject({runId:"run-a",status:"stop_requested"})
})

it("settles a doubly-failed recovery on the adopted identity instead of clearing the banner", async () => {
  let retryReads = 0
  mocks.get.mockImplementation(async (path:string) => path === "execute/defaults" ? capability
    : ++retryReads === 1 ? waiting("s","run-a") : waiting("s","run-b"))
  mocks.fence.mockImplementation(() => ({kind:"confirmed",runId: retryReads === 1 ? "run-a" : "run-b"}))
  // Both the original and the recovered exact Stop fail without reaching the server.
  mocks.stop.mockRejectedValue(new Error("network unreachable"))
  const hook = await mount({sessionId:"s",running:true,root:true})
  await applyChanges(hook.current.stop)
  expect(mocks.stop).toHaveBeenCalledTimes(2)
  // The banner survives on the adopted successor identity, keeping Refresh available.
  expect(hook.current.offer).toMatchObject({runId:"run-b",status:"stop_unconfirmed"})
  await applyChanges(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(hook.current.offer).toMatchObject({runId:"run-b",status:"stop_unconfirmed"})
  // Connectivity recovers: Refresh re-offers the successor and the exact Stop succeeds.
  mocks.stop.mockClear(); mocks.stop.mockResolvedValue(undefined)
  await applyChanges(hook.current.refresh)
  expect(hook.current.offer).toMatchObject({runId:"run-b",status:"waiting"})
  await applyChanges(hook.current.stop)
  expect(mocks.stop).toHaveBeenCalledExactlyOnceWith("s","run-b")
  expect(hook.current.offer).toMatchObject({runId:"run-b",status:"stop_requested"})
})

it("keeps stop_unconfirmed and recovers through Refresh when no waiting offer remains", async () => {
  let offerAvailable = true
  mocks.get.mockImplementation(async (path:string) => path === "execute/defaults" ? capability
    : offerAvailable ? waiting("s","run-a") : {session_id:"s",status:"unavailable"})
  mocks.fence.mockReturnValue({kind:"confirmed",runId:"run-a"})
  mocks.stop.mockRejectedValue(new Error("409 Requested run is not the current cancellable owner"))
  const hook = await mount({sessionId:"s",running:true,root:true}, true)
  await applyChanges(hook.current.stop)
  await applyChanges(() => { offerAvailable = false })
  expect(hook.current.offer).toMatchObject({runId:"run-a",status:"stop_unconfirmed"})
  // Refresh re-observes the backend; with no offer left the banner clears instead of fabricating one.
  await applyChanges(hook.current.refresh)
  expect(hook.current.offer).toBeNull()
})

it("Refresh restores a live offer whose identity the fence re-confirms after a stop_unconfirmed dead end", async () => {
  let offered = "run-a"
  mocks.get.mockImplementation(async (path:string) => path === "execute/defaults" ? capability : waiting("s",offered))
  mocks.fence.mockImplementation(() => ({kind:"confirmed",runId:offered}))
  mocks.stop.mockRejectedValue(new Error("synthetic lost Stop response"))
  const hook = await mount({sessionId:"s",running:true,root:true}, true)
  await applyChanges(hook.current.stop)
  expect(hook.current.offer).toMatchObject({runId:"run-a",status:"stop_unconfirmed"})
  // The banner shows a Refresh control for the terminal stop diagnostic.
  expect([...document.querySelectorAll("button")].some(b => b.textContent === uiText("live_retry_refresh"))).toBe(true)
  offered = "run-b"
  await applyChanges(hook.current.refresh)
  expect(hook.current.offer).toMatchObject({runId:"run-b",status:"waiting"})
  // After Refresh the Stop control is usable again and targets the refreshed identity.
  mocks.stop.mockClear(); mocks.stop.mockResolvedValue(undefined)
  await applyChanges(hook.current.stop)
  expect(mocks.stop).toHaveBeenCalledExactlyOnceWith("s","run-b")
  expect(hook.current.offer).toMatchObject({runId:"run-b",status:"stop_requested"})
})

it("Refresh does not resurrect an offer whose identity the fence cannot confirm", async () => {
  mocks.fence.mockReturnValue({kind:"confirmed",runId:"other-run"})
  const hook = await mount({sessionId:"s",running:true,root:true})
  await applyChanges(hook.current.stop)
  // The entry fence precheck refuses the borrowed identity before any Stop is sent.
  expect(hook.current.offer).toMatchObject({status:"identity_unavailable"})
  await applyChanges(hook.current.refresh)
  expect(hook.current.offer).toMatchObject({status:"identity_unavailable"})
  expect(mocks.stop).not.toHaveBeenCalled()
})

it("retains a lost receipt only in the tab's session storage", async () => {
  mocks.postOnce.mockRejectedValueOnce(new Error("synthetic lost response"))
  const first = await mount({ sessionId: "s", running: true, root: true })
  await applyChanges(first.current.confirm)
  expect(readLiveBootstrapConfirmation("s", "run-a")).toBe("pending")
  expect(sessionStorage.length).toBe(1)
  expect(localStorage.length).toBe(0)
  first.unmount()

  const sameTab = await mount({ sessionId: "s", running: true, root: true })
  expect(sameTab.current.offer?.status).toBe("unconfirmed")
  await applyChanges(sameTab.current.confirm)
  expect(mocks.postOnce).toHaveBeenCalledTimes(1)
  sameTab.unmount()

  sessionStorage.clear()
  const freshTab = await mount({ sessionId: "s", running: true, root: true })
  expect(freshTab.current.offer?.status).toBe("waiting")
  expect(mocks.postOnce).toHaveBeenCalledTimes(1)
})

it("never offers confirmation or Stop for a waiting window beyond the negotiated limit", async () => {
  const boundedCapability = { ...capability, live_bootstrap_resume: { ...capability.live_bootstrap_resume, offer_timeout_ms: 1000 } }
  mocks.get.mockImplementation(async (path: string) => path === "execute/defaults" ? boundedCapability : waiting("s", "run-a", 1001))
  const hook = await mount({ sessionId: "s", running: true, root: true }, true)
  expect(hook.current.canPrepare).toBe(true)
  expect(hook.current.offer).toBeNull()
  expect(document.querySelectorAll("button")).toHaveLength(0)
  await applyChanges(hook.current.confirm)
  await applyChanges(hook.current.stop)
  expect(mocks.postOnce).not.toHaveBeenCalled()
  expect(mocks.stop).not.toHaveBeenCalled()
})
