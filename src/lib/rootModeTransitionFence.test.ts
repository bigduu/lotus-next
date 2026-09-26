import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { beginRootModeOperation, finishRootModeOperation, readRootModeFence, type RootModeOperation } from "./rootModeTransitionFence"

const sessionId = "root"
const birthToken = "a".repeat(64)
const keyFor = (operation: RootModeOperation) => `lotus-next.root-mode-operation.v2.root.${operation.operationId}`
beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

it("keeps another marker visible when a concurrent deletion changes Storage indices", () => {
  const first = beginRootModeOperation(sessionId, 0, birthToken, true)!
  const second: RootModeOperation = { ...first, operationId: "0:550e8400-e29b-41d4-a716-446655440000" }
  localStorage.setItem(keyFor(second), JSON.stringify(second))
  const get = localStorage.getItem.bind(localStorage)
  vi.spyOn(localStorage, "getItem").mockImplementation((key) => {
    if (key === keyFor(first)) localStorage.removeItem(key)
    return get(key)
  })
  expect(readRootModeFence(sessionId)).toEqual({ kind: "pending", operations: [second] })
})

it("uses one native key snapshot instead of shifting Storage.key indices", () => {
  const first = beginRootModeOperation(sessionId, 0, birthToken, true)!
  const second: RootModeOperation = { ...first, operationId: "0:550e8400-e29b-41d4-a716-446655440000" }
  localStorage.setItem(keyFor(second), JSON.stringify(second))
  const keys = Object.keys
  vi.spyOn(Object, "keys").mockImplementationOnce((storage) => {
    const snapshot = keys(storage)
    localStorage.removeItem(keyFor(first))
    return snapshot
  })
  const indexed = vi.spyOn(localStorage, "key")
  expect(readRootModeFence(sessionId)).toEqual({ kind: "pending", operations: [second] })
  expect(indexed).not.toHaveBeenCalled()
})

it("treats an already resolved identity as idempotent without clearing another operation", () => {
  const first = beginRootModeOperation(sessionId, 0, birthToken, true)!
  expect(finishRootModeOperation(sessionId, first)).toBe(true)
  const second = beginRootModeOperation(sessionId, 1, birthToken, false)!
  expect(finishRootModeOperation(sessionId, first)).toBe(true)
  expect(readRootModeFence(sessionId)).toEqual({ kind: "pending", operations: [second] })
})

it("retains a legacy combined-chat marker regardless of new operation state", () => {
  localStorage.setItem(`lotus-next.root-mode-transition.v1.${sessionId}`, "legacy")
  expect(beginRootModeOperation(sessionId, 0, birthToken, true)).toBeNull()
  expect(readRootModeFence(sessionId)).toEqual({ kind: "legacy" })
})
