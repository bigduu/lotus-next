import { beforeEach, describe, expect, it, vi } from "vitest"
const api = vi.hoisted(() => ({ get: vi.fn(), postOnce: vi.fn() }))
vi.mock("@services/api", () => ({ apiClient: api, getBackendStorageScope: () => "https://fixture.test/api/v1" }))
import { readLiveBootstrapCapability, readLiveBootstrapOffer, confirmLiveBootstrapOffer,
  beginLiveBootstrapConfirmation, finishLiveBootstrapConfirmation } from "./liveBootstrapRetry"

const capability = { upstream_retry: { supported_modes: ["bounded", "until_cancelled"] }, live_bootstrap_resume: {
  protocol_version: 1, offer_timeout_ms: 600000, waiting_endpoint: "execute/{session_id}/retry",
  continue_run_header: "Bamboo-Run-Id", initial_opt_in_field: "live_bootstrap_resume" } }
beforeEach(() => { api.get.mockReset(); api.postOnce.mockReset(); sessionStorage.clear() })

describe("live bootstrap retry API", () => {
  it("accepts only the exact advertised live protocol and continuous mode", async () => {
    api.get.mockResolvedValue(capability)
    expect(await readLiveBootstrapCapability()).toEqual({ offerTimeoutMs: 600000 })
    expect(api.get).toHaveBeenCalledExactlyOnceWith("execute/defaults", { cache: "no-store" })
  })
  it.each([
    {}, { ...capability, live_bootstrap_resume: null },
    { ...capability, live_bootstrap_resume: { ...capability.live_bootstrap_resume, protocol_version: 2 } },
    { ...capability, live_bootstrap_resume: { ...capability.live_bootstrap_resume, waiting_endpoint: "other" } },
    { ...capability, live_bootstrap_resume: { ...capability.live_bootstrap_resume, continue_run_header: "other" } },
    { ...capability, live_bootstrap_resume: { ...capability.live_bootstrap_resume, initial_opt_in_field: "other" } },
    { ...capability, live_bootstrap_resume: { ...capability.live_bootstrap_resume, offer_timeout_ms: 0 } },
    { ...capability, upstream_retry: { supported_modes: ["bounded"] } },
  ])("does not opt in for unsupported or malformed capability %j", async value => {
    api.get.mockResolvedValue(value)
    expect(await readLiveBootstrapCapability()).toBeNull()
  })
  it("reads the server-authoritative offer for the encoded session", async () => {
    api.get.mockResolvedValue({ session_id: "session/a", run_id: "run-1", status: "retry_waiting", expires_in_ms: 52000, confirming: false })
    expect(await readLiveBootstrapOffer("session/a", 600000)).toEqual({ kind: "waiting", runId: "run-1", expiresInMs: 52000, confirming: false })
    expect(api.get).toHaveBeenCalledExactlyOnceWith("execute/session%2Fa/retry", { cache: "no-store" })
  })
  it("accepts an unavailable result only when it belongs to the requested session", async () => {
    api.get.mockResolvedValue({ session_id: "session/a", status: "unavailable" })
    expect(await readLiveBootstrapOffer("session/a", 600000)).toEqual({ kind: "unavailable" })
  })
  it.each([
    { session_id: "other", status: "unavailable" },
    { session_id: "other", run_id: "run-1", status: "retry_waiting", expires_in_ms: 1, confirming: false },
    { session_id: "s", run_id: "bad\nrun", status: "retry_waiting", expires_in_ms: 1, confirming: false },
    { session_id: "s", run_id: "run-1", status: "retry_waiting", expires_in_ms: 600001, confirming: false },
    { session_id: "s", run_id: "run-1", status: "retry_waiting", expires_in_ms: -1, confirming: false },
    { session_id: "s", run_id: "run-1", status: "retry_waiting", expires_in_ms: 1, confirming: "no" },
  ])("rejects a foreign or malformed waiting response %j", async value => {
    api.get.mockResolvedValue(value)
    await expect(readLiveBootstrapOffer("s", 600000)).rejects.toThrow()
  })
  it("confirms only the exact run with the one allowed request field", async () => {
    api.postOnce.mockResolvedValue({ session_id: "session/a", run_id: "run-1", status: "retry_continuing" })
    await confirmLiveBootstrapOffer("session/a", "run-1")
    expect(api.postOnce).toHaveBeenCalledExactlyOnceWith("execute/session%2Fa", { upstream_retry: { mode: "until_cancelled" } },
      { headers: { "Bamboo-Run-Id": "run-1" } })
  })
  it.each([
    { session_id: "other", run_id: "run-1", status: "retry_continuing" },
    { session_id: "s", run_id: "newer", status: "retry_continuing" },
    { session_id: "s", run_id: "run-1", status: "started" },
  ])("does not accept a foreign or malformed continuation receipt %j", async value => {
    api.postOnce.mockResolvedValue(value)
    await expect(confirmLiveBootstrapOffer("s", "run-1")).rejects.toThrow()
    expect(api.postOnce).toHaveBeenCalledTimes(1)
  })
  it("never sends a continuation for an invalid header identity", async () => {
    await expect(confirmLiveBootstrapOffer("s", "bad\nrun")).rejects.toThrow()
    expect(api.postOnce).not.toHaveBeenCalled()
  })
})

describe("live bootstrap confirmation fence", () => {
  it("keeps an uncertain or accepted request fenced across a fresh read", () => {
    const pending = beginLiveBootstrapConfirmation("s", "run-a")!
    expect(pending).not.toBeNull()
    expect(beginLiveBootstrapConfirmation("s", "run-a")).toBeNull()
    expect(finishLiveBootstrapConfirmation(pending, "unknown")).toBe(true)
    expect(beginLiveBootstrapConfirmation("s", "run-a")).toBeNull()
    expect(finishLiveBootstrapConfirmation(pending, "accepted")).toBe(true)
    expect(beginLiveBootstrapConfirmation("s", "run-a")).toBeNull()
  })
  it("releases a definite refusal only for its own run and never erases a successor", () => {
    const old = beginLiveBootstrapConfirmation("s", "run-a")!
    const next = beginLiveBootstrapConfirmation("s", "run-b")!
    expect(next).not.toBeNull()
    expect(finishLiveBootstrapConfirmation(old, "refused")).toBe(false)
    expect(beginLiveBootstrapConfirmation("s", "run-b")).toBeNull()
    expect(finishLiveBootstrapConfirmation(next, "refused")).toBe(true)
    expect(beginLiveBootstrapConfirmation("s", "run-b")).not.toBeNull()
  })
  it("does not dispatch when protected storage cannot be written", () => {
    const blocked = vi.spyOn(sessionStorage, "setItem").mockImplementation(() => { throw new Error("blocked") })
    expect(beginLiveBootstrapConfirmation("s", "run-a")).toBeNull()
    blocked.mockRestore()
  })
})
