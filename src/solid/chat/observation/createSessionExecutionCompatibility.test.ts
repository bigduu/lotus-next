import { createRoot, createSignal, flush } from "solid-js"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { ApiError } from "@services/api/errors"
import { clearSessionCompatibilityObservations, observeSessionExecutionConflict } from "@services/chat/sessionExecutionCompatibility"

import { createSessionExecutionCompatibility } from "../observation"

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), listeners: new Set<() => void>() }))
vi.mock("@services/chat/AgentService", () => ({ agentClient: { getSession: mocks.getSession } }))
vi.mock("@services/chat/v2Stream", () => ({ onReconnected: (listener: () => void) => {
  mocks.listeners.add(listener)
  return () => { mocks.listeners.delete(listener) }
} }))
let dispose: (() => void) | undefined
let value: ReturnType<typeof createSessionExecutionCompatibility>
let setSession: (id: string | null) => void
const body = (id: string, status = "compatible") => ({ session: { id, execution_compatibility: {
  session_version: status === "legacy_compatible" ? null : status === "conflict" ? 99 : 1,
  current_session_version: 1, status, history_readable: true, execution_allowed: status !== "conflict",
  conflicts: status === "conflict" ? [{ code: "unsupported_session_version", message: "New canonical conflict" }] : [],
} } })

async function apply(change: () => void | Promise<void>) {
  const result = change()
  flush()
  await result
  await Promise.resolve()
  flush()
}
const mount = (id: string | null) => apply(() => setSession(id))
const reconnect = () => apply(() => { for (const callback of [...mocks.listeners]) callback() })

beforeEach(() => {
  mocks.getSession.mockReset().mockImplementation(async (id: string) => body(id))
  mocks.listeners.clear()
  createRoot((cleanup) => {
    dispose = cleanup
    const [session, select] = createSignal<string | null>(null)
    setSession = select
    value = createSessionExecutionCompatibility(session)
  })
  flush()
})
afterEach(() => {
  dispose?.()
  dispose = undefined
  clearSessionCompatibilityObservations()
  mocks.listeners.clear()
})

it("refreshes current bound canonical detail after a real reconnect notification", async () => {
  mocks.getSession.mockResolvedValueOnce(body("a")).mockResolvedValueOnce(body("a", "conflict"))
  await mount("a"); expect(value.blocked).toBe(false)
  await reconnect()
  expect(mocks.getSession).toHaveBeenCalledTimes(2)
  expect(mocks.getSession).toHaveBeenLastCalledWith("a")
  expect(value.blocked).toBe(true)
})
it("a fresh legacy-compatible reconnect read recovers the view without any execution callback", async () => {
  mocks.getSession.mockResolvedValueOnce(body("a", "conflict")).mockResolvedValueOnce(body("a", "legacy_compatible"))
  await mount("a"); expect(value.blocked).toBe(true)
  await reconnect(); expect(value.blocked).toBe(false)
  expect(value.report?.status).toBe("legacy_compatible")
  expect(mocks.getSession.mock.calls).toEqual([["a"], ["a"]])
})
it("follows only the current binding and removes the reconnect listener on unmount", async () => {
  await mount("a"); await mount("b")
  await reconnect()
  expect(mocks.getSession.mock.calls).toEqual([["a"], ["b"], ["b"]])
  expect(mocks.listeners.size).toBe(1)
  await apply(async () => { dispose?.(); dispose = undefined })
  await reconnect(); expect(mocks.listeners.size).toBe(0)
  expect(mocks.getSession).toHaveBeenCalledTimes(3)
})
it("an execution refusal still wins over an older reconnect read", async () => {
  let resolve!: (v: ReturnType<typeof body>) => void
  mocks.getSession.mockResolvedValueOnce(body("a")).mockImplementationOnce(() => new Promise((done) => { resolve = done }))
  await mount("a"); await reconnect()
  const error = new ApiError("incompatible", 409, "Conflict", JSON.stringify({ session_id: "a",
    error: { code: "session_execution_incompatible" }, compatibility: body("a", "conflict").session.execution_compatibility }))
  await apply(async () => { expect(observeSessionExecutionConflict("a", error)).toBe(true) })
  await apply(async () => { resolve(body("a")); await Promise.resolve() })
  expect(value.blocked).toBe(true)
})

it("keeps an unobserved session unassessed until canonical detail arrives", async () => {
  let resolve!: (result: ReturnType<typeof body>) => void
  mocks.getSession.mockImplementationOnce(() => new Promise((finish) => { resolve = finish }))
  await mount("a")
  expect(value).toMatchObject({ report: null, observed: false, loading: true, readError: false })
  await apply(() => resolve(body("a", "legacy_compatible")))
  expect(value).toMatchObject({ observed: true, loading: false, blocked: false, report: { status: "legacy_compatible" } })
})
