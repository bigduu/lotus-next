import { describe, expect, it } from "vitest"
import {
  UNLIMITED_OUTPUT,
  buildLimitRows,
  formatTokenCount,
  parseTokenCount,
  validateLimitRows,
  type LimitRowDraft,
} from "./modelLimits"

describe("model limit table helpers", () => {
  it("parses and formats compact context-window values", () => {
    expect(parseTokenCount("258K")).toBe(258_000)
    expect(parseTokenCount("1M")).toBe(1_000_000)
    expect(parseTokenCount("1.5M")).toBe(1_500_000)
    expect(parseTokenCount("128,000")).toBe(128_000)
    expect(parseTokenCount("1.2")).toBeNull()
    expect(formatTokenCount(1_000_000)).toBe("1M")
    expect(formatTokenCount(258_000)).toBe("258K")
  })

  it("shows persisted overrides plus used models without persisting default rows", () => {
    const rows = buildLimitRows(
      [{ model_pattern: "gpt-5", max_context_tokens: 400_000, max_output_tokens: 128_000 }],
      ["glm-5.3", "gpt-5"],
    )

    expect(rows.map((row) => [row.model_pattern, row.customized, row.isCustom])).toEqual([
      ["gpt-5", true, false],
      ["glm-5.3", false, false],
    ])
    const result = validateLimitRows(rows)
    expect(result).toEqual({
      overrides: [
        {
          model_pattern: "gpt-5",
          max_context_tokens: 400_000,
          max_output_tokens: 128_000,
        },
      ],
    })
    expect(validateLimitRows([{
      ...rows[1],
      customized: true,
      max_context_tokens: "258K",
    }])).toEqual({
      overrides: [{
        model_pattern: "glm-5.3",
        max_context_tokens: 258_000,
        max_output_tokens: null,
      }],
    })
  })

  it("accepts a custom model with compact values and rejects duplicate patterns", () => {
    const row = {
      id: "custom",
      model_pattern: "custom-model",
      isCustom: true,
      customized: true,
      max_context_tokens: "258K",
      max_output_tokens: "32K",
      safety_margin: "10K",
    } satisfies LimitRowDraft

    expect(validateLimitRows([row])).toEqual({
      overrides: [
        {
          model_pattern: "custom-model",
          max_context_tokens: 258_000,
          max_output_tokens: 32_000,
          safety_margin: 10_000,
        },
      ],
    })
    expect(validateLimitRows([{ ...row, max_context_tokens: "" }])).toHaveProperty("error")
    expect(validateLimitRows([row, { ...row, id: "duplicate", model_pattern: "CUSTOM-MODEL" }]))
      .toEqual({ error: "模型「CUSTOM-MODEL」重复" })
  })

  it("round-trips unlimited, automatic, and explicit output limits", () => {
    const overrides = [
      {
        model_pattern: "unlimited-model",
        max_context_tokens: 256_000,
        max_output_tokens: null,
        unlimited_output: true,
      },
      {
        model_pattern: "automatic-model",
        max_context_tokens: 256_000,
        max_output_tokens: null,
      },
      {
        model_pattern: "fixed-model",
        max_context_tokens: 256_000,
        max_output_tokens: 32_000,
      },
    ]
    const rows = buildLimitRows(overrides, [])
    expect(rows.map((row) => row.max_output_tokens)).toEqual([UNLIMITED_OUTPUT, null, "32K"])
    expect(validateLimitRows(rows, true)).toEqual({ overrides })
    expect(validateLimitRows(rows)).toHaveProperty("error")
    expect(validateLimitRows([{ ...rows[1], max_output_tokens: "" }], true)).toEqual({
      overrides: [overrides[1]],
    })
    expect(validateLimitRows([{ ...rows[0], max_output_tokens: "invalid" }], true)).toHaveProperty("error")
  })
})
