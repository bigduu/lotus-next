import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError, RequestTimeoutError } from "@services/api/errors"
import { agentClient, type RootModeOperationInput, type RootModeOperationResponse } from "@services/chat/AgentService"
import { beginRootModeOperation, finishRootModeOperation, getRootModeFenceState, readRootModeFence } from "@/lib/rootModeTransitionFence"
import { useRootOrchestrationMode } from "./useRootOrchestrationMode"

vi.mock("@services/chat/AgentService", () => ({ agentClient: {
  getSession: vi.fn(), selectRootMode: vi.fn(), recoverRootMode: vi.fn(),
} }))

const sessionId = "root/session"
const birthToken = "a".repeat(64)
let enabled = false
let epoch = 0
let root: Root
let host: HTMLDivElement
let value: ReturnType<typeof useRootOrchestrationMode>
function Harness({ kind }: { kind?: "root" | "child" }) {
  value = useRootOrchestrationMode(sessionId, kind)
  return null
}
const receipt = (operation: RootModeOperationInput, status: "committed" | "fenced" | "rejected_incompatible" = "committed"): RootModeOperationResponse => ({
  status, operation_id: operation.operationId, expected_epoch: operation.expectedEpoch,
  resulting_epoch: operation.expectedEpoch + 1, enabled_at_completion: enabled,
  root_tool_authority_revision: 1,
})
const apiError = (status: number, code: string) => new ApiError(code, status, "Error", JSON.stringify({ error: { code, message: code } }))
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve() }) }
const mount = async (kind?: "root" | "child") => { await act(async () => root.render(<Harness kind={kind} />)) }

beforeEach(() => {
  localStorage.clear(); enabled = false; epoch = 0
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.mocked(agentClient.getSession).mockReset().mockImplementation(async () => ({ session: {
    id: sessionId, kind: "root", root_orchestration_only: enabled,
    root_mode_transition_epoch: epoch, root_mode_birth_token: birthToken,
  } }) as Awaited<ReturnType<typeof agentClient.getSession>>)
  vi.mocked(agentClient.selectRootMode).mockReset().mockImplementation(async (_id, operation) => {
    enabled = operation.enabled; epoch = operation.expectedEpoch + 1
    return receipt(operation)
  })
  vi.mocked(agentClient.recoverRootMode).mockReset().mockImplementation(async (_id, operation) => {
    epoch = operation.expectedEpoch + 1
    return receipt(operation, "fenced")
  })
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks() })

describe("recoverable Root mode operations", () => {
  it("persists identity before a mode-only select and reads the committed authority", async () => {
    vi.mocked(agentClient.selectRootMode).mockImplementationOnce(async (_id, operation) => {
      expect(readRootModeFence(sessionId)).toMatchObject({ kind: "pending", operations: [operation] })
      enabled = true; epoch = 1
      return receipt(operation)
    })
    await mount("root")
    await act(async () => { await value.change(true) })
    expect(agentClient.selectRootMode).toHaveBeenCalledOnce()
    expect(agentClient.recoverRootMode).not.toHaveBeenCalled()
    expect(getRootModeFenceState(sessionId)).toBe("clear")
    expect(value.selected).toBe(true)
  })

  it("recovers a lost select response with the same identity without resending selection", async () => {
    vi.mocked(agentClient.selectRootMode).mockRejectedValueOnce(new RequestTimeoutError())
    await mount("root")
    await act(async () => { await value.change(true) })
    const operation = vi.mocked(agentClient.selectRootMode).mock.calls[0][1]
    expect(agentClient.recoverRootMode).toHaveBeenCalledWith(sessionId, operation)
    expect(agentClient.selectRootMode).toHaveBeenCalledOnce()
    expect(getRootModeFenceState(sessionId)).toBe("clear")
    expect(value.selected).toBe(false)
    expect(value.error).toContain("安全撤销")
  })

  it.each([
    [503, "root_mode_authority_unavailable"], [503, "root_mode_outcome_unconfirmed"],
    [409, "root_mode_authority_unavailable"], [409, "root_mode_operation_conflict"],
    [412, "root_mode_precondition_failed"],
  ])("keeps %s %s fenced until a verified recovery terminal", async (status, code) => {
    vi.mocked(agentClient.selectRootMode).mockRejectedValueOnce(apiError(status, code))
    vi.mocked(agentClient.recoverRootMode).mockRejectedValue(apiError(status, code))
    await mount("root")
    await act(async () => { await value.change(true) })
    expect(getRootModeFenceState(sessionId)).toBe("uncertain")
    expect(value.selected).toBeNull()
    expect(value.recoverable).toBe(true)
    vi.mocked(agentClient.recoverRootMode).mockImplementationOnce(async (_id, operation) => {
      enabled = true; epoch = 1
      return receipt(operation)
    })
    await act(async () => { await value.retry() })
    expect(getRootModeFenceState(sessionId)).toBe("clear")
    expect(value.selected).toBe(true)
  })

  it("clears only an explicit birth mismatch and reloads the new lifetime", async () => {
    vi.mocked(agentClient.selectRootMode).mockRejectedValueOnce(apiError(412, "root_mode_birth_mismatch"))
    await mount("root")
    await act(async () => { await value.change(true) })
    expect(getRootModeFenceState(sessionId)).toBe("clear")
    expect(agentClient.recoverRootMode).not.toHaveBeenCalled()
    expect(value.error).toContain("会话身份已改变")
  })

  it("rejects a successor response with another operation identity", async () => {
    vi.mocked(agentClient.selectRootMode).mockRejectedValueOnce(new RequestTimeoutError())
    vi.mocked(agentClient.recoverRootMode).mockImplementationOnce(async (_id, operation) => ({
      status: "fenced_by_successor", operation_id: `${operation.expectedEpoch}:00000000-0000-0000-0000-000000000000`,
      expected_epoch: operation.expectedEpoch, current_epoch: 2, current_enabled: true, root_tool_authority_revision: 2,
    }))
    await mount("root")
    await act(async () => { await value.change(true) })
    expect(getRootModeFenceState(sessionId)).toBe("uncertain")
    vi.mocked(agentClient.recoverRootMode).mockImplementationOnce(async (_id, operation) => {
      enabled = true; epoch = 2
      return { status: "fenced_by_successor", operation_id: operation.operationId,
        expected_epoch: operation.expectedEpoch, current_epoch: 2, current_enabled: true, root_tool_authority_revision: 2 }
    })
    await act(async () => { await value.retry() })
    expect(getRootModeFenceState(sessionId)).toBe("clear")
    expect(value.selected).toBe(true)
  })

  it("refreshes this tab after another tab clears its operation marker", async () => {
    await mount("root")
    const operation = beginRootModeOperation(sessionId, 0, birthToken, true)!
    await flush()
    expect(value.selected).toBeNull()
    enabled = true; epoch = 1
    expect(finishRootModeOperation(sessionId, operation)).toBe(true)
    window.dispatchEvent(new StorageEvent("storage", { key: `lotus-next.root-mode-operation.v2.${encodeURIComponent(sessionId)}.${operation.operationId}` }))
    await flush()
    expect(value.selected).toBe(true)
    expect(agentClient.recoverRootMode).not.toHaveBeenCalled()
  })

  it("refreshes an external removal even when this tab never observed the pending marker", async () => {
    await mount("root")
    enabled = true; epoch = 1
    window.dispatchEvent(new StorageEvent("storage", {
      key: `lotus-next.root-mode-operation.v2.${encodeURIComponent(sessionId)}.0:550e8400-e29b-41d4-a716-446655440000`,
      oldValue: "completed elsewhere", newValue: null,
    }))
    await flush()
    expect(value.selected).toBe(true)
    expect(agentClient.getSession).toHaveBeenCalledTimes(2)
    expect(agentClient.recoverRootMode).not.toHaveBeenCalled()
  })

  it("finishes duplicate recovery when another tab already removed the same marker", async () => {
    const operation = beginRootModeOperation(sessionId, 0, birthToken, true)!
    let complete!: (response: RootModeOperationResponse) => void
    vi.mocked(agentClient.recoverRootMode).mockReturnValueOnce(new Promise((resolve) => { complete = resolve }))
    await mount("root")
    enabled = true; epoch = 1
    expect(finishRootModeOperation(sessionId, operation)).toBe(true)
    await act(async () => { complete(receipt(operation)); await Promise.resolve() })
    expect(getRootModeFenceState(sessionId)).toBe("clear")
    expect(value.selected).toBe(true)
  })

  it("keeps legacy combined-chat markers fail closed without attempting recovery", async () => {
    localStorage.setItem(`lotus-next.root-mode-transition.v1.${sessionId}`, JSON.stringify({ id: "legacy", requested: false }))
    await mount("root")
    expect(value.unsafe).toBe(true)
    expect(value.recoverable).toBe(false)
    expect(value.error).toContain("旧版聊天")
    expect(agentClient.recoverRootMode).not.toHaveBeenCalled()
  })

  it("does not send a mode operation when storage cannot persist its marker", async () => {
    await mount("root")
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("quota denied") })
    await act(async () => { await value.change(true) })
    expect(agentClient.selectRootMode).not.toHaveBeenCalled()
    expect(value.error).toContain("切换未发送")
  })

  it("keeps Child read-only without loading Root authority", async () => {
    await mount("child")
    await act(async () => { await value.change(true) })
    expect(value.child).toBe(true)
    expect(agentClient.getSession).not.toHaveBeenCalled()
    expect(agentClient.selectRootMode).not.toHaveBeenCalled()
  })
})
