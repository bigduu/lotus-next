import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useAppStore } from "@shared/store/appStore"
import { agentClient, type ReasoningEffort, type RootModeOperationInput, type RootModeOperationResponse } from "@services/chat/AgentService"
import { RequestTimeoutError } from "@services/api/errors"
import { readRootModeFence } from "@/lib/rootModeTransitionFence"
import { useRootOrchestrationMode } from "./useRootOrchestrationMode"
import { useRootThinkingMode } from "./useRootThinkingMode"

vi.mock("@shared/store/appStore", async () => {
  const { create } = await import("zustand")
  type State = import("@shared/store/appStore").AppState
  const store = create<State>(() => ({ inputStates: {}, chats: [],
    getInputState: (id: string) => store.getState().inputStates[id] ?? { content: "", contentRevision: 0 },
    setInputThinkingMode: vi.fn((id: string, thinkingMode: "standard" | "ultra") => {
      store.setState((s) => ({ inputStates: { ...s.inputStates, [id]: { ...s.getInputState(id), thinkingMode } } }))
      return true
    }),
    setInputReasoningEffort: vi.fn(), changeSessionReasoningEffort: vi.fn(),
  } as unknown as State))
  return { useAppStore: store }
})
vi.mock("@services/chat/AgentService", async (original) => ({
  ...await original<typeof import("@services/chat/AgentService")>(),
  agentClient: { getSession: vi.fn(), selectRootMode: vi.fn(), recoverRootMode: vi.fn() },
}))

let renderer: Root
let host: HTMLDivElement
let id: string
let serial = 0
let enabled: boolean
let effort: ReasoningEffort | undefined
let epoch: number
let running: boolean
const birth = "a".repeat(64)
const values = new Map<string, ReturnType<typeof useRootThinkingMode>>()
const order: string[] = []
function Harness({ name = "one", sessionId = id, kind = "root", draftKey = "", disabled = false }: {
  name?: string; sessionId?: string | null; kind?: "root" | "child"; draftKey?: string; disabled?: boolean
}) {
  const root = useRootOrchestrationMode(sessionId, kind)
  values.set(name, useRootThinkingMode({ sessionId, draftKey, ordinarySelection: "max", root, disabled }))
  return null
}
const value = (name = "one") => values.get(name)!
const terminal = (op: RootModeOperationInput, status: "committed" | "fenced" | "rejected_incompatible" = "committed"): RootModeOperationResponse => ({
  status, operation_id: op.operationId, expected_epoch: op.expectedEpoch,
  resulting_epoch: op.expectedEpoch + 1, enabled_at_completion: enabled,
  thinking_mode_at_completion: enabled ? "ultra" : "standard", root_tool_authority_revision: 1,
})
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const mount = async (element = <Harness />) => { await act(async () => renderer.render(element)) }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear(); id = `root-${++serial}`; enabled = false; effort = "high"; epoch = 0; running = false
  values.clear(); order.length = 0
  useAppStore.setState({ inputStates: {}, chats: [] })
  vi.mocked(useAppStore.getState().setInputThinkingMode).mockClear()
  vi.mocked(useAppStore.getState().setInputReasoningEffort).mockClear()
  vi.mocked(useAppStore.getState().changeSessionReasoningEffort).mockReset().mockImplementation(async (_id, next) => {
    order.push(`effort:${next}`); effort = next ?? undefined
  })
  vi.mocked(agentClient.getSession).mockReset().mockImplementation(async (sessionId) => {
    order.push(`read:${enabled ? "ultra" : "standard"}:${effort}`)
    return { session: { id: sessionId, kind: "root", thinking_mode: enabled ? "ultra" : "standard",
      root_orchestration_only: enabled, root_mode_transition_epoch: epoch, root_mode_birth_token: birth,
      reasoning_effort: effort, is_running: running } } as Awaited<ReturnType<typeof agentClient.getSession>>
  })
  vi.mocked(agentClient.selectRootMode).mockReset().mockImplementation(async (_id, op) => {
    order.push(`mode:${op.enabled}`); enabled = op.enabled; epoch = op.expectedEpoch + 1
    return terminal(op)
  })
  vi.mocked(agentClient.recoverRootMode).mockReset().mockRejectedValue(new Error("outcome unavailable"))
  host = document.body.appendChild(document.createElement("div")); renderer = createRoot(host)
})
afterEach(() => { act(() => renderer.unmount()); host.remove() })

describe("Root product Ultra composition", () => {
  it("enables Ultra without upgrading the independent High effort to Max", async () => {
    await mount()
    await act(async () => { await value().choose("ultra") })
    expect(value().thinkingMode).toBe("ultra")
    expect(value().ordinaryValue).toBe("high")
    expect(useAppStore.getState().changeSessionReasoningEffort).not.toHaveBeenCalled()
    expect(order).toEqual(["read:standard:high", "mode:true", "read:ultra:high"])
  })
  it("confirms mode exit before saving a concrete ordinary choice and rereads it", async () => {
    enabled = true; await mount()
    await act(async () => { await value().choose("max") })
    expect(order).toEqual(["read:ultra:high", "mode:false", "read:standard:high", "effort:max", "read:standard:max"])
    expect(value().thinkingMode).toBe("standard"); expect(value().ordinaryValue).toBe("max")
  })
  it("accepts omitted ordinary override as Auto after leaving Ultra", async () => {
    enabled = true; await mount()
    await act(async () => { await value().choose("auto") })
    expect(value().ordinaryValue).toBe("auto")
    expect(useAppStore.getState().changeSessionReasoningEffort).toHaveBeenCalledWith(id, null)
    expect(value().error).toBeNull()
  })
  it("keeps a partial exit visible without rolling back to Ultra or changing the draft", async () => {
    enabled = true
    useAppStore.setState({ inputStates: { [id]: { content: "retain task", contentRevision: 1, referenceText: "", attachments: [] } } })
    vi.mocked(useAppStore.getState().changeSessionReasoningEffort).mockRejectedValueOnce(new Error("ordinary offline"))
    await mount(); await act(async () => { await value().choose("low") })
    expect(value().thinkingMode).toBe("standard"); expect(value().ordinaryValue).toBe("high")
    expect(value().error).toContain("已退出 Ultra"); expect(value().error).toContain("ordinary offline")
    expect(useAppStore.getState().inputStates[id].content).toBe("retain task")
    expect(agentClient.selectRootMode).toHaveBeenCalledTimes(1)
    await act(async () => { await value().retry() }); expect(value().error).toBeNull()
  })
  it("does not describe a Standard ordinary save failure as an exit from Ultra", async () => {
    vi.mocked(useAppStore.getState().changeSessionReasoningEffort).mockRejectedValueOnce(new Error("ordinary offline"))
    await mount(); await act(async () => { await value().choose("low") })
    expect(value().thinkingMode).toBe("standard"); expect(value().ordinaryValue).toBe("high")
    expect(value().error).toContain("ordinary offline")
    expect(value().error).not.toContain("已退出 Ultra")
  })
  it("does not save ordinary effort after an unconfirmed mode operation", async () => {
    enabled = true; vi.mocked(agentClient.selectRootMode).mockRejectedValueOnce(new RequestTimeoutError())
    await mount(); await act(async () => { await value().choose("low") })
    expect(value().thinkingMode).toBeNull(); expect(value().blocked).toBe(true)
    expect(readRootModeFence(id).kind).toBe("pending")
    expect(useAppStore.getState().changeSessionReasoningEffort).not.toHaveBeenCalled()
  })
  it("does not continue ordinary save from a historical committed receipt when GET is Ultra", async () => {
    enabled = true
    vi.mocked(agentClient.selectRootMode).mockImplementationOnce(async (_id, op) => {
      epoch = 2 // A later committed operation restored Ultra.
      return { ...terminal(op), enabled_at_completion: false, thinking_mode_at_completion: "standard" }
    })
    await mount(); await act(async () => { await value().choose("low") })
    expect(value().thinkingMode).toBe("ultra")
    expect(useAppStore.getState().changeSessionReasoningEffort).not.toHaveBeenCalled()
  })
  it("blocks active runs and ignores a stale pane's ordinary continuation after navigation", async () => {
    running = true; await mount(); await act(async () => { await value().choose("ultra") })
    expect(agentClient.selectRootMode).not.toHaveBeenCalled()
    running = false; await act(async () => { await value().retry() })
    const ack = deferred<RootModeOperationResponse>()
    vi.mocked(agentClient.selectRootMode).mockReturnValueOnce(ack.promise)
    let changing!: Promise<void>; act(() => { changing = value().choose("low") })
    const operation = vi.mocked(agentClient.selectRootMode).mock.calls[0][1]
    await mount(<Harness sessionId="another-root" />)
    await act(async () => { ack.resolve(terminal(operation)); await changing })
    expect(useAppStore.getState().changeSessionReasoningEffort).not.toHaveBeenCalled()
  })
  it("shares pending lock and refreshes a peer's mode and ordinary proof after completion", async () => {
    enabled = true; await mount(<><Harness /><Harness name="peer" /></>)
    const saved = deferred<void>()
    vi.mocked(useAppStore.getState().changeSessionReasoningEffort).mockImplementationOnce(async () => {
      effort = "low"; await saved.promise
    })
    let changing!: Promise<void>; await act(async () => { changing = value().choose("low"); await Promise.resolve() })
    expect(value("peer").busy).toBe(true)
    await act(async () => { await value("peer").choose("ultra") })
    expect(agentClient.selectRootMode).toHaveBeenCalledTimes(1)
    await act(async () => { saved.resolve(); await changing })
    expect(value("peer").thinkingMode).toBe("standard")
    expect(value("peer").ordinaryValue).toBe("low")
    await act(async () => { await value().choose("ultra") })
    expect(value("peer").thinkingMode).toBe("ultra")
    expect(value("peer").ordinaryValue).toBe("low")
    expect(agentClient.recoverRootMode).not.toHaveBeenCalled()
  })
  it("never recovers the in-flight select when Retry is invoked", async () => {
    const ack = deferred<RootModeOperationResponse>()
    vi.mocked(agentClient.selectRootMode).mockReturnValueOnce(ack.promise)
    await mount(); let changing!: Promise<void>; act(() => { changing = value().choose("ultra") })
    await act(async () => { await value().retry() })
    expect(agentClient.recoverRootMode).not.toHaveBeenCalled()
    const op = vi.mocked(agentClient.selectRootMode).mock.calls[0][1]
    enabled = true; await act(async () => { ack.resolve(terminal(op)); await changing })
  })
  it("uses the existing draft mode field for new Root and preserves ordinary when Ultra is chosen", async () => {
    await mount(<Harness sessionId={null} draftKey="__new_chat_pane2__" />)
    await act(async () => { await value().choose("ultra") })
    expect(value().requestValue).toBe(true)
    expect(useAppStore.getState().setInputThinkingMode).toHaveBeenCalledWith("__new_chat_pane2__", "ultra")
    expect(useAppStore.getState().setInputReasoningEffort).not.toHaveBeenCalled()
    await act(async () => { await value().choose("none") })
    expect(value().requestValue).toBe(false)
    expect(useAppStore.getState().setInputReasoningEffort).toHaveBeenCalledWith("__new_chat_pane2__", "none")
    expect(agentClient.selectRootMode).not.toHaveBeenCalled()
  })
  it("keeps Child ordinary errors accessible without accepting Ultra", async () => {
    await mount(<Harness kind="child" />)
    await act(async () => { await value().choose("ultra") })
    expect(agentClient.selectRootMode).not.toHaveBeenCalled()
    vi.mocked(useAppStore.getState().changeSessionReasoningEffort).mockRejectedValueOnce(new Error("Child save denied"))
    await act(async () => { await value().choose("low") })
    expect(value().error).toContain("Child save denied")
    expect(agentClient.getSession).not.toHaveBeenCalled()
  })
})
