import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  backendSupports,
  onBackendFeatures,
  resetBackendFeatures,
  setBackendFeatures,
} from "./backendFeatures"

// The capability gate decides whether an optional request may exist at all, so
// this asserts the gate itself rather than the request it protects: a frontend
// released ahead of its backend must never collect a 404 by probing.
describe("backend capability gate", () => {
  beforeEach(() => resetBackendFeatures())

  it("reports no capability before the backend has said anything", () => {
    expect(backendSupports("worktree_merge_state")).toBe(false)
  })

  it("reads an omitted field as no capability, not as unknown-but-try-anyway", () => {
    setBackendFeatures(undefined)
    expect(backendSupports("worktree_merge_state")).toBe(false)
  })

  it("enables only the capabilities the backend actually advertises", () => {
    setBackendFeatures(["worktree_merge_state"])
    expect(backendSupports("worktree_merge_state")).toBe(true)
    expect(backendSupports("something_else")).toBe(false)
  })

  it("notifies gated work when capabilities arrive after first render", () => {
    const listener = vi.fn()
    const unsubscribe = onBackendFeatures(listener)
    setBackendFeatures(["worktree_merge_state"])
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    setBackendFeatures([])
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
