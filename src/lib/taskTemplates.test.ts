import { beforeEach, describe, expect, it } from "vitest"
import {
  acknowledgePendingTemplatePrompt,
  peekPendingTemplatePrompt,
  setPendingTemplatePrompt,
} from "./taskTemplates"

describe("pending template prompt acknowledgement", () => {
  beforeEach(() => {
    setPendingTemplatePrompt(null)
  })

  it("does not consume an unacknowledged read", () => {
    setPendingTemplatePrompt("review prompt")

    const firstRead = peekPendingTemplatePrompt()
    const secondRead = peekPendingTemplatePrompt()

    expect(firstRead).toEqual({ prompt: "review prompt", revision: expect.any(Number) })
    expect(secondRead).toEqual(firstRead)
  })

  it("consumes a matching acknowledgement exactly once", () => {
    setPendingTemplatePrompt("debug prompt")
    const snapshot = peekPendingTemplatePrompt()
    if (!snapshot) throw new Error("expected a pending template prompt")

    expect(acknowledgePendingTemplatePrompt(snapshot)).toBe(true)
    expect(peekPendingTemplatePrompt()).toBeNull()
    expect(acknowledgePendingTemplatePrompt(snapshot)).toBe(false)
  })

  it("does not let a late acknowledgement clear a later template selection", () => {
    setPendingTemplatePrompt("first prompt")
    const firstSnapshot = peekPendingTemplatePrompt()
    if (!firstSnapshot) throw new Error("expected the first template prompt")

    setPendingTemplatePrompt("second prompt")
    const secondSnapshot = peekPendingTemplatePrompt()
    if (!secondSnapshot) throw new Error("expected the second template prompt")

    expect(acknowledgePendingTemplatePrompt(firstSnapshot)).toBe(false)
    expect(peekPendingTemplatePrompt()).toEqual(secondSnapshot)
    expect(acknowledgePendingTemplatePrompt(secondSnapshot)).toBe(true)
    expect(peekPendingTemplatePrompt()).toBeNull()
  })

  it("rejects an old acknowledgement when the same template is selected again", () => {
    setPendingTemplatePrompt("same prompt")
    const firstSnapshot = peekPendingTemplatePrompt()
    if (!firstSnapshot) throw new Error("expected the first template prompt")

    setPendingTemplatePrompt("same prompt")
    const secondSnapshot = peekPendingTemplatePrompt()
    if (!secondSnapshot) throw new Error("expected the replacement template prompt")

    expect(acknowledgePendingTemplatePrompt(firstSnapshot)).toBe(false)
    expect(peekPendingTemplatePrompt()).toEqual(secondSnapshot)
  })
})
