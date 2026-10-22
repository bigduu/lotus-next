import { afterEach, beforeEach, expect, it, vi } from "vitest"

const stream = vi.hoisted(() => ({ subscribeAgent: vi.fn((_id, handlers, dispatch) => {
  dispatch({ type:"error",message:"legacy terminal error" },handlers)
  return { promise:Promise.resolve(),close:vi.fn() }
}) }))
vi.mock("./v2Stream", () => ({ subscribeAgent:stream.subscribeAgent,stopAgent:vi.fn(() => false) }))
beforeEach(async () => {
  const { installRuntimeConfig } = await import("@/runtime/runtimeConfig")
  const { resolveDefaultBrowserRuntimeConfig } = await import("@/runtime/browserRuntime")
  installRuntimeConfig(resolveDefaultBrowserRuntimeConfig())
})
afterEach(() => { vi.doUnmock("./runDiagnostic"); vi.resetModules(); vi.clearAllMocks() })

it("still observes the legacy terminal error if optional diagnostics cannot load", async () => {
  vi.doMock("./runDiagnostic", () => { throw new Error("synthetic optional chunk unavailable") })
  const { AgentClient } = await import("./AgentService")
  const onError = vi.fn()
  await new AgentClient().subscribeToEvents("synthetic-session",{ onError })
  expect(stream.subscribeAgent).toHaveBeenCalledTimes(1)
  expect(onError).toHaveBeenCalledExactlyOnceWith("legacy terminal error")
})

it("does not connect an aborted subscription after a delayed decoder becomes available", async () => {
  let release!: () => void
  const loading = new Promise<void>((resolve) => { release=resolve })
  vi.doMock("./runDiagnostic", async () => { await loading; return { decodeRunDiagnostic:() => null } })
  const { AgentClient } = await import("./AgentService")
  const controller = new AbortController(), onError = vi.fn()
  const subscribed = new AgentClient().subscribeToEvents("synthetic-session",{ onError },controller)
  controller.abort(); release(); await subscribed
  expect(stream.subscribeAgent).not.toHaveBeenCalled()
  expect(onError).not.toHaveBeenCalled()
})
