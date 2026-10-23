import { describe, expect, it } from "vitest"
import {
  compressionBudgetReceived, compressionFeedbackFromStatus, compressionRunEnded,
  summaryFeedback, type ContextCompressionFeedback,
} from "./contextCompression"

describe("safe context compression feedback", () => {
  it.each([
    ["failed_candidate_plan:/private/token=secret", { status: "failed", reason: "candidate_plan" }],
    ["failed_postcondition:raw summary", { status: "failed", reason: "postcondition" }],
    ["failed:provider message", { status: "failed", reason: "other" }],
    ["failed_future_status:sensitive", { status: "failed", reason: "other" }],
    ["deferred_tool_protocol:tool result", { status: "deferred", reason: "tool_protocol" }],
    ["deferred_future_status:sensitive", { status: "deferred", reason: "other" }],
    ["skipped_no_background_model", { status: "skipped", reason: "no_model" }],
    ["skipped_future_status:sensitive", { status: "skipped", reason: "other" }],
    ["cancelled:private reason", { status: "cancelled" }],
    ["canceled", { status: "cancelled" }],
  ])("projects %s without backend diagnostics", (status, feedback) => {
    expect(compressionFeedbackFromStatus(null, status as string)).toEqual(feedback)
  })

  it("only an observed start begins the summary animation", () => {
    for (const progress of ["chunk:1/3", "future_status:secret", "started:unrecognized"]) {
      expect(compressionFeedbackFromStatus(null, progress)).toBeNull()
    }
    const running = compressionFeedbackFromStatus(null, "started")!
    expect(running).toEqual({ status: "running" })
    expect(compressionFeedbackFromStatus(running, "chunk:1/3")).toBe(running)
    for (const malformed of [null, undefined, {}, 0]) {
      expect(compressionFeedbackFromStatus(running, malformed as unknown as string)).toBe(running)
    }
  })

  it("requires an observed attempt to report completion and waits for an actual budget", () => {
    expect(summaryFeedback(null)).toEqual({ status: "unconfirmed" })
    expect(compressionFeedbackFromStatus(null, "completed")).toEqual({ status: "unconfirmed" })
    const completed = summaryFeedback({ status: "running" })
    expect(completed).toEqual({ status: "completed", awaitingUsage: true })
    const refreshed = compressionBudgetReceived(completed)
    expect(refreshed).toEqual({ status: "completed", awaitingUsage: false })
    expect(summaryFeedback(refreshed)).toBe(refreshed)
    expect(compressionFeedbackFromStatus(refreshed, "completed")).toBe(refreshed)
  })

  it.each<ContextCompressionFeedback>([
    { status: "failed", reason: "candidate_plan" },
    { status: "deferred", reason: "tool_protocol" },
    { status: "skipped", reason: "no_model" },
    { status: "cancelled" },
    { status: "unconfirmed" },
  ])("late receipts and usage do not turn $status into success", (outcome) => {
    expect(summaryFeedback(outcome)).toBe(outcome)
    expect(compressionBudgetReceived(outcome)).toBe(outcome)
    expect(compressionFeedbackFromStatus(outcome, "unknown:private detail")).toBe(outcome)
    expect(compressionRunEnded(outcome)).toBe(outcome)
  })

  it("distinguishes a cancelled summary from an unconfirmed run ending", () => {
    expect(compressionRunEnded({ status: "running" }, true)).toEqual({ status: "cancelled" })
    expect(compressionRunEnded({ status: "running" })).toEqual({ status: "unconfirmed" })
    const completed: ContextCompressionFeedback = { status: "completed", awaitingUsage: true }
    expect(compressionRunEnded(completed, true)).toBe(completed)
    expect(compressionRunEnded(null)).toBeNull()
  })
})
