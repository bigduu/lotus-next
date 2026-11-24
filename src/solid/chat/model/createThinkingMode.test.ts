import { createRoot, createSignal, flush } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { appStore } from "@shared/store/appStore/state"
import { agentClient, type ReasoningEffort, type RootModeOperationInput, type RootModeOperationResponse } from "@services/chat/AgentService"
import { RequestTimeoutError } from "@services/api/errors"
import { readRootModeFence } from "@/lib/rootModeTransitionState"
import { createRootModeAuthority } from "./createRootModeAuthority"
import { createThinkingMode } from "./createThinkingMode"

vi.mock("@shared/store/appStore/state", async () => {
  const { createStore } = await import("zustand/vanilla")
  type State = import("@shared/store/appStore/state").AppState
  const store = createStore<State>(() => ({ inputStates: {}, chats: [],
    getInputState: (id: string) => store.getState().inputStates[id] ?? { content: "", contentRevision: 0 },
    setInputThinkingMode: vi.fn((id: string, thinkingMode: "standard" | "ultra") => {
      store.setState((s) => ({ inputStates: { ...s.inputStates, [id]: { ...s.getInputState(id), thinkingMode } } }))
      return true
    }),
    setInputReasoningEffort: vi.fn(), changeSessionReasoningEffort: vi.fn(),
  } as unknown as State))
  return { appStore: store }
})
vi.mock("@services/chat/AgentService", async (original) => ({
  ...await original<typeof import("@services/chat/AgentService")>(),
  agentClient: { getSession: vi.fn(), selectRootMode: vi.fn(), recoverRootMode: vi.fn() },
}))

let id: string
let serial = 0
let enabled: boolean
let effort: ReasoningEffort | undefined
let epoch: number
let running: boolean
const birth = "a".repeat(64)
const order: string[] = []

function mountPane({ session = id, kind = "root", draftKey = "", disabled = false }: {
  session?: string | null
  kind?: "root" | "child"
  draftKey?: string
  disabled?: boolean
}) {
  return createRoot((dispose) => {
    const [sessionId, select] = createSignal(session)
    const root = createRootModeAuthority(sessionId, () => kind)
    const thinking = createThinkingMode({
      sessionId, root, draftKey: () => draftKey, ordinarySelection: () => "max", disabled: () => disabled,
      defaultChatUltra: () => false,
    })
    return { root, thinking, select, dispose }
  })
}
const panes = new Map<string, ReturnType<typeof mountPane>>()
const pane = (name = "one") => panes.get(name)!
const value = (name = "one") => pane(name).thinking

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
async function settle(change?: () => unknown) {
  const result = change?.()
  flush()
  await result
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  flush()
}
const mount = async (primary: Parameters<typeof mountPane>[0] = {}, peer?: string) => {
  panes.set("one", mountPane(primary))
  if (peer) panes.set(peer, mountPane({}))
  await settle()
}
beforeEach(() => {
  localStorage.clear(); id = `root-${++serial}`; enabled = false; effort = "high"; epoch = 0; running = false
  order.length = 0
  appStore.setState({ inputStates: {}, chats: [] })
  vi.mocked(appStore.getState().setInputThinkingMode).mockClear()
  vi.mocked(appStore.getState().setInputReasoningEffort).mockClear()
  vi.mocked(appStore.getState().changeSessionReasoningEffort).mockReset().mockImplementation(async (_id, next) => {
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
})
afterEach(() => {
  for (const mounted of panes.values()) mounted.dispose()
  panes.clear()
})

describe("Root product Ultra composition", () => {
  it("reports active selection as progress in both panes without weakening the safety fence", async () => {
    const response = deferred<RootModeOperationResponse>()
    let operation!: RootModeOperationInput
    vi.mocked(agentClient.selectRootMode).mockImplementationOnce((_id, op) => {
      operation = op
      return response.promise
    })
    await mount({}, "two")
    const selection = value().choose("ultra")
    await settle()
    expect(readRootModeFence(id).kind).toBe("pending")
    for (const name of ["one", "two"]) {
      expect(pane(name).root.unsafe).toBe(true)
      expect(value(name)).toMatchObject({ busy: true, disabled: true, error: null })
    }
    // A second click cannot bypass the shared lock or create another request.
    await settle(() => value("two").choose("low"))
    expect(agentClient.selectRootMode).toHaveBeenCalledTimes(1)
    await settle(async () => {
      enabled = true; epoch = operation.expectedEpoch + 1
      response.resolve(terminal(operation))
      await selection
    })
    expect(readRootModeFence(id).kind).toBe("clear")
    for (const name of ["one", "two"]) {
      expect(pane(name).root.unsafe).toBe(false)
      expect(value(name)).toMatchObject({ busy: false, thinkingMode: "ultra", error: null })
    }
  })

  it("enables Ultra without upgrading the independent High effort to Max", async () => {
    await mount()
    await settle(() => value().choose("ultra"))
    expect(value().thinkingMode).toBe("ultra")
    expect(value().ordinaryValue).toBe("high")
    expect(appStore.getState().changeSessionReasoningEffort).not.toHaveBeenCalled()
    expect(order).toEqual(["read:standard:high", "mode:true", "read:ultra:high"])
  })
  it("confirms mode exit before saving a concrete ordinary choice and rereads it", async () => {
    enabled = true; await mount()
    await settle(() => value().choose("max"))
    expect(order).toEqual(["read:ultra:high", "mode:false", "read:standard:high", "effort:max", "read:standard:max"])
    expect(value().thinkingMode).toBe("standard"); expect(value().ordinaryValue).toBe("max")
  })
  it("accepts omitted ordinary override as Auto after leaving Ultra", async () => {
    enabled = true; await mount()
    await settle(() => value().choose("auto"))
    expect(value().ordinaryValue).toBe("auto")
    expect(appStore.getState().changeSessionReasoningEffort).toHaveBeenCalledWith(id, null)
    expect(value().error).toBeNull()
  })
  it("keeps a partial exit visible without rolling back to Ultra or changing the draft", async () => {
    enabled = true
    appStore.setState({ inputStates: { [id]: { content: "retain task", contentRevision: 1, referenceText: "", attachments: [] } } })
    vi.mocked(appStore.getState().changeSessionReasoningEffort).mockRejectedValueOnce(new Error("ordinary offline"))
    await mount(); await settle(() => value().choose("low"))
    expect(value().thinkingMode).toBe("standard"); expect(value().ordinaryValue).toBe("high")
    expect(value().error).toContain("已退出 Ultra"); expect(value().error).toContain("ordinary offline")
    expect(appStore.getState().inputStates[id].content).toBe("retain task")
    expect(agentClient.selectRootMode).toHaveBeenCalledTimes(1)
    await settle(() => value().retry()); expect(value().error).toBeNull()
  })
  it("does not describe a Standard ordinary save failure as an exit from Ultra", async () => {
    vi.mocked(appStore.getState().changeSessionReasoningEffort).mockRejectedValueOnce(new Error("ordinary offline"))
    await mount(); await settle(() => value().choose("low"))
    expect(value().thinkingMode).toBe("standard"); expect(value().ordinaryValue).toBe("high")
    expect(value().error).toContain("ordinary offline")
    expect(value().error).not.toContain("已退出 Ultra")
  })
  it("does not save ordinary effort after an unconfirmed mode operation", async () => {
    enabled = true; vi.mocked(agentClient.selectRootMode).mockRejectedValueOnce(new RequestTimeoutError())
    await mount(); await settle(() => value().choose("low"))
    expect(value().thinkingMode).toBeNull(); expect(value().blocked).toBe(true)
    expect(readRootModeFence(id).kind).toBe("pending")
    expect(appStore.getState().changeSessionReasoningEffort).not.toHaveBeenCalled()
  })
  it("does not continue ordinary save from a historical committed receipt when GET is Ultra", async () => {
    enabled = true
    vi.mocked(agentClient.selectRootMode).mockImplementationOnce(async (_id, op) => {
      epoch = 2 // A later committed operation restored Ultra.
      return { ...terminal(op), enabled_at_completion: false, thinking_mode_at_completion: "standard" }
    })
    await mount(); await settle(() => value().choose("low"))
    expect(value().thinkingMode).toBe("ultra")
    expect(appStore.getState().changeSessionReasoningEffort).not.toHaveBeenCalled()
  })
  it("blocks active runs and ignores a stale pane's ordinary continuation after navigation", async () => {
    running = true; await mount(); await settle(() => value().choose("ultra"))
    expect(agentClient.selectRootMode).not.toHaveBeenCalled()
    running = false; await settle(() => value().retry())
    const ack = deferred<RootModeOperationResponse>()
    vi.mocked(agentClient.selectRootMode).mockReturnValueOnce(ack.promise)
    const changing = value().choose("low")
    const operation = vi.mocked(agentClient.selectRootMode).mock.calls[0][1]
    await settle(() => pane().select("another-root"))
    await settle(async () => { ack.resolve(terminal(operation)); await changing })
    expect(appStore.getState().changeSessionReasoningEffort).not.toHaveBeenCalled()
  })
  it("shares pending lock and refreshes a peer's mode and ordinary proof after completion", async () => {
    enabled = true; await mount({}, "peer")
    const saved = deferred<void>()
    vi.mocked(appStore.getState().changeSessionReasoningEffort).mockImplementationOnce(async () => {
      effort = "low"; await saved.promise
    })
    const changing = value().choose("low")
    await settle()
    expect(value("peer").busy).toBe(true)
    await settle(() => value("peer").choose("ultra"))
    expect(agentClient.selectRootMode).toHaveBeenCalledTimes(1)
    await settle(async () => { saved.resolve(); await changing })
    expect(value("peer").thinkingMode).toBe("standard")
    expect(value("peer").ordinaryValue).toBe("low")
    await settle(() => value().choose("ultra"))
    expect(value("peer").thinkingMode).toBe("ultra")
    expect(value("peer").ordinaryValue).toBe("low")
    expect(agentClient.recoverRootMode).not.toHaveBeenCalled()
  })
  it("never recovers the in-flight select when Retry is invoked", async () => {
    const ack = deferred<RootModeOperationResponse>()
    vi.mocked(agentClient.selectRootMode).mockReturnValueOnce(ack.promise)
    await mount()
    const changing = value().choose("ultra")
    await settle(() => value().retry())
    expect(agentClient.recoverRootMode).not.toHaveBeenCalled()
    const op = vi.mocked(agentClient.selectRootMode).mock.calls[0][1]
    enabled = true; await settle(async () => { ack.resolve(terminal(op)); await changing })
  })
  it("uses the existing draft mode field for new Root and preserves ordinary when Ultra is chosen", async () => {
    await mount({ session: null, draftKey: "__new_chat_pane2__" })
    await settle(() => value().choose("ultra"))
    expect(value().requestValue).toBe(true)
    expect(appStore.getState().setInputThinkingMode).toHaveBeenCalledWith("__new_chat_pane2__", "ultra")
    expect(appStore.getState().setInputReasoningEffort).not.toHaveBeenCalled()
    await settle(() => value().choose("none"))
    expect(value().requestValue).toBe(false)
    expect(appStore.getState().setInputReasoningEffort).toHaveBeenCalledWith("__new_chat_pane2__", "none")
    expect(agentClient.selectRootMode).not.toHaveBeenCalled()
  })
  it("keeps Child ordinary errors accessible without accepting Ultra", async () => {
    await mount({ kind: "child" })
    await settle(() => value().choose("ultra"))
    expect(agentClient.selectRootMode).not.toHaveBeenCalled()
    vi.mocked(appStore.getState().changeSessionReasoningEffort).mockRejectedValueOnce(new Error("Child save denied"))
    await settle(() => value().choose("low"))
    expect(value().error).toContain("Child save denied")
    expect(agentClient.getSession).not.toHaveBeenCalled()
  })
})
