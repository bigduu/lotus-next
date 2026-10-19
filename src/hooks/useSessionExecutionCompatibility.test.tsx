import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { ApiError } from "@services/api/errors"
import { clearSessionCompatibilityObservations, observeSessionExecutionConflict } from "@services/chat/sessionExecutionCompatibility"
import { useSessionExecutionCompatibility } from "./useSessionExecutionCompatibility"

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), listeners: new Set<() => void>() }))
vi.mock("@services/chat/AgentService", () => ({ agentClient: { getSession: mocks.getSession } }))
vi.mock("@services/chat/v2Stream", () => ({ onReconnected: (listener: () => void) => {
  mocks.listeners.add(listener); return () => { mocks.listeners.delete(listener) }
} }))
let root: Root | null
let value: ReturnType<typeof useSessionExecutionCompatibility>
const body = (id: string, status = "compatible") => ({ session: { id, execution_compatibility: {
  session_version: status === "legacy_compatible" ? null : status === "conflict" ? 99 : 1,
  current_session_version: 1, status, history_readable: true, execution_allowed: status !== "conflict",
  conflicts: status === "conflict" ? [{ code: "unsupported_session_version", message: "New canonical conflict" }] : [],
} } })
function Pane({ id }: { id: string | null }) { value = useSessionExecutionCompatibility(id); return null }
const mount = async (id: string | null) => act(async () => root!.render(<Pane id={id} />))
const reconnect = async () => act(async () => { for (const callback of [...mocks.listeners]) callback(); await Promise.resolve() })
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  mocks.getSession.mockReset().mockImplementation(async (id: string) => body(id))
  mocks.listeners.clear()
  root = createRoot(document.body.appendChild(document.createElement("div")))
})
afterEach(() => {
  if (root) act(() => root!.unmount())
  document.body.replaceChildren(); clearSessionCompatibilityObservations(); mocks.listeners.clear(); vi.unstubAllGlobals()
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
  await act(async () => { root!.unmount(); root = null })
  await reconnect(); expect(mocks.listeners.size).toBe(0)
  expect(mocks.getSession).toHaveBeenCalledTimes(3)
})
it("an execution refusal still wins over an older reconnect read", async () => {
  let resolve!: (v: ReturnType<typeof body>) => void
  mocks.getSession.mockResolvedValueOnce(body("a")).mockImplementationOnce(() => new Promise((done) => { resolve = done }))
  await mount("a"); await reconnect()
  const error = new ApiError("incompatible", 409, "Conflict", JSON.stringify({ session_id: "a",
    error: { code: "session_execution_incompatible" }, compatibility: body("a", "conflict").session.execution_compatibility }))
  await act(async () => { expect(observeSessionExecutionConflict("a", error)).toBe(true) })
  await act(async () => { resolve(body("a")); await Promise.resolve() })
  expect(value.blocked).toBe(true)
})
