import { describe, expect, it } from "vitest"
import { getPrefixCachePercentage, mapTokenBudgetUsage } from "./tokenBudget"

describe("provider prefix-cache usage", () => {
  it("maps the exact provider split and calculates the disjoint hit rate", () => {
    const usage = mapTokenBudgetUsage({
      system_tokens: 100,
      summary_tokens: 0,
      window_tokens: 900,
      total_tokens: 1_000,
      budget_limit: 100_000,
      truncation_occurred: false,
      segments_removed: 0,
      cache_read_input_tokens: 7_500,
      provider_prompt_usage: {
        input_tokens: 2_000,
        cache_creation_input_tokens: 500,
        cache_read_input_tokens: 7_500,
        retained_from_previous_call: true,
      },
    })

    expect(usage?.prefixCache).toEqual({
      inputTokens: 2_000,
      cacheCreationInputTokens: 500,
      cacheReadInputTokens: 7_500,
      retainedFromPreviousRound: true,
    })
    expect(getPrefixCachePercentage(usage!.prefixCache!)).toBe(75)
  })
})
