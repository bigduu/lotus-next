import { beforeEach, describe, expect, it, vi } from "vitest"
import { createSliceHarness } from "./__tests__/sliceHarness"

vi.mock("@services/storage/StorageManager", () => ({
  StorageManager: {
    getInstance: () => ({
      saveInputReasoning: vi.fn().mockResolvedValue(undefined),
      saveLastUsedReasoningEffort: vi.fn().mockResolvedValue(undefined),
    }),
  },
}))

import {
  createInputStateSlice,
  type InputStateSlice,
} from "./inputStateSlice"

const createHarness = () =>
  createSliceHarness(
    createInputStateSlice as unknown as (
      set: (partial: unknown) => void,
      get: () => InputStateSlice,
      api: unknown,
    ) => InputStateSlice,
  )

describe("input draft revision ownership", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("rejects stale compare-and-clear even when another pane writes the same value", () => {
    const store = createHarness()
    store.getState().setInputContent("session", "same draft")
    const capturedRevision = store.getState().inputStates.session.contentRevision

    store.getState().setInputContent("session", "same draft")

    expect(
      store.getState().setInputContentIfRevision("session", capturedRevision, ""),
    ).toBe(false)
    expect(store.getState().inputStates.session.content).toBe("same draft")
  })

  it("clears only the exact captured revision", () => {
    const store = createHarness()
    store.getState().setInputContent("session", "submitted draft")
    const capturedRevision = store.getState().inputStates.session.contentRevision

    expect(
      store.getState().setInputContentIfRevision("session", capturedRevision, ""),
    ).toBe(true)
    expect(store.getState().inputStates.session.content).toBe("")
    expect(store.getState().inputStates.session.contentRevision).not.toBe(capturedRevision)
  })

  it("atomically moves only a revision-owned draft into an empty acknowledged session", () => {
    const store = createHarness()
    store.getState().setInputContent("new-chat", "first draft")
    const staleRevision = store.getState().inputStates["new-chat"].contentRevision
    store.getState().setInputContent("new-chat", "newer draft")
    const currentRevision = store.getState().inputStates["new-chat"].contentRevision

    expect(
      store
        .getState()
        .moveInputContentIfRevision("new-chat", staleRevision, "acknowledged-session"),
    ).toBe(false)
    expect(
      store
        .getState()
        .moveInputContentIfRevision("new-chat", currentRevision, "acknowledged-session"),
    ).toBe(true)
    expect(store.getState().inputStates["new-chat"].content).toBe("")
    expect(store.getState().inputStates["acknowledged-session"].content).toBe("newer draft")
  })

  it("does not reuse an old revision after the input state is cleared and recreated", () => {
    const store = createHarness()
    store.getState().setInputContent("session", "old draft")
    const oldRevision = store.getState().inputStates.session.contentRevision
    store.getState().clearInputState("session")
    store.getState().setInputContent("session", "new draft")

    expect(store.getState().setInputContentIfRevision("session", oldRevision, "")).toBe(false)
    expect(store.getState().inputStates.session.content).toBe("new draft")
  })
})
