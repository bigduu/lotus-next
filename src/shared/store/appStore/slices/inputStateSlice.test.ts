import { beforeEach, describe, expect, it, vi } from "vitest"
import { createSliceHarness } from "./__tests__/sliceHarness"

vi.mock("@services/storage/StorageManager", () => ({
  INPUT_THINKING_MODE_BY_DRAFT_STORAGE_KEY: "chat_input_thinking_mode_by_draft_v1",
  StorageManager: {
    getInstance: () => ({
      saveInputReasoning: vi.fn().mockResolvedValue(undefined),
      saveInputThinkingMode: vi.fn().mockResolvedValue(undefined),
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

describe("independent thinking-mode drafts", () => {
  beforeEach(() => { localStorage.clear() })

  it("restores isolated pane modes while ordinary reasoning stays independent", () => {
    const store = createHarness()
    expect(store.getState().setInputThinkingMode("", "ultra")).toBe(true)
    expect(store.getState().setInputThinkingMode("__new_chat_pane2__", "standard")).toBe(true)
    store.getState().setInputReasoningEffort("", "max")
    expect(store.getState().inputStates[""].thinkingMode).toBe("ultra")
    const restored = createHarness()
    restored.getState().setInputContent("", "new primary draft")
    restored.getState().setInputContent("__new_chat_pane2__", "secondary draft")
    expect(restored.getState().inputStates[""].thinkingMode).toBe("ultra")
    expect(restored.getState().inputStates.__new_chat_pane2__.thinkingMode).toBe("standard")
    expect(restored.getState().inputStates[""].reasoningEffort).toBeUndefined()
  })

  it("rejects stale same-value ACKs and clears only the captured field", () => {
    const store = createHarness()
    store.getState().setInputThinkingMode("", "ultra")
    const submitted = store.getState().inputStates[""].thinkingModeRevision!
    store.getState().setInputThinkingMode("", "ultra")
    store.getState().setInputReasoningEffort("", "none")
    store.getState().setInputContent("", "keep this draft")
    store.getState().setInputThinkingMode("__new_chat_pane2__", "ultra")
    expect(store.getState().clearInputThinkingModeIfRevision("", submitted)).toBe(false)
    expect(store.getState().clearInputThinkingModeIfRevision("", store.getState().inputStates[""].thinkingModeRevision!)).toBe(true)
    expect(store.getState().inputStates[""].thinkingMode).toBeUndefined()
    expect(store.getState().inputStates[""].reasoningEffort).toBe("none")
    expect(store.getState().inputStates[""].content).toBe("keep this draft")
    const restored = createHarness()
    expect(restored.getState().getInputState("").thinkingMode).toBeUndefined()
    expect(restored.getState().getInputState("__new_chat_pane2__").thinkingMode).toBe("ultra")
  })

  it.each(["max", "Ultra", null, true])("rejects malformed stored/input mode %s", (mode) => {
    localStorage.setItem("chat_input_thinking_mode_by_draft_v1", JSON.stringify({ "": mode }))
    expect(createHarness().getState().getInputState("").thinkingMode).toBeUndefined()
    const store = createHarness()
    expect(store.getState().setInputThinkingMode("", mode as never)).toBe(false)
    expect(store.getState().inputStates[""]).toBeUndefined()
  })

  it("does not report a saved mode when storage rejects the write", () => {
    vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => { throw new Error("quota") })
    const store = createHarness()
    expect(store.getState().setInputThinkingMode("", "ultra")).toBe(false)
    expect(store.getState().inputStates[""]).toBeUndefined()
  })
})

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

  it("does not let legacy new-chat or last-used reasoning shadow Provider Settings", () => {
    localStorage.setItem(
      "chat_input_reasoning_by_session_v1",
      JSON.stringify({ "": "max", __new_chat_pane2__: "max" }),
    )
    localStorage.setItem("chat_input_reasoning_last_used_v1", "max")
    const store = createHarness()

    store.getState().setInputContent("", "main draft")
    store.getState().setInputContent("__new_chat_pane2__", "split draft")

    expect(store.getState().inputStates[""].reasoningEffort).toBeUndefined()
    expect(
      store.getState().inputStates.__new_chat_pane2__.reasoningEffort,
    ).toBeUndefined()
  })

  it("keeps Auto and Off as distinct explicit picker states", () => {
    const store = createHarness()

    store.getState().setInputReasoningEffort("session", "auto")
    expect(store.getState().inputStates.session.reasoningEffort).toBe("auto")

    store.getState().setInputReasoningEffort("session", "none")
    expect(store.getState().inputStates.session.reasoningEffort).toBe("none")

    store.getState().clearInputReasoningEffort("session")
    expect(store.getState().inputStates.session.reasoningEffort).toBeUndefined()
  })
})
