import { describe, expect, it } from "vitest"
import { OutputRateTracker } from "./outputRate"

describe("output rate", () => {
  it("waits for a measured interval and distinguishes Chinese text density", () => {
    const latin = new OutputRateTracker()
    const cjk = new OutputRateTracker()
    latin.record("abcd", 0); cjk.record("中文测试", 0)
    expect(latin.rate(0)).toBeNull()
    latin.record("abcd", 1_000); cjk.record("中文测试", 1_000)
    expect(latin.rate(1_000)).toBe(1)
    expect(cjk.rate(1_000)).toBe(3)
  })
  it("hides idle generation and starts a fresh burst after a tool pause", () => {
    const tracker = new OutputRateTracker()
    tracker.record("abcd", 0); tracker.record("abcd", 1_000)
    expect(tracker.rate(3_000)).toBeNull()
    tracker.record("abcd", 4_000)
    expect(tracker.rate(4_000)).toBeNull()
    tracker.record("abcd", 5_000)
    expect(tracker.rate(5_000)).toBe(1)
    tracker.reset()
    expect(tracker.rate(5_000)).toBeNull()
  })
  it("does not produce a rate from reversed timestamps", () => {
    const tracker = new OutputRateTracker()
    tracker.record("abcd", 1_000); tracker.record("abcd", 0)
    expect(tracker.rate(0)).toBeNull()
  })
})
