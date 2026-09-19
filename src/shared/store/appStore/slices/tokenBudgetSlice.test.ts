import { createStore } from "zustand/vanilla"
import { describe, expect, it } from "vitest"
import { createTokenBudgetSlice, type TokenBudgetSlice } from "./tokenBudgetSlice"

const usage = (overrides: Partial<Parameters<TokenBudgetSlice["updateTokenUsage"]>[1]> = {}) => ({
  systemTokens: 100,
  summaryTokens: 0,
  windowTokens: 900,
  totalTokens: 1_000,
  budgetLimit: 100_000,
  ...overrides,
})

describe("tokenBudgetSlice prefix cache", () => {
  it("retains the last completed provider value across the next preflight snapshot", () => {
    const store = createStore<TokenBudgetSlice>()(createTokenBudgetSlice)

    store.getState().updateTokenUsage("session-1", usage({
      prefixCache: {
        inputTokens: 2_000,
        cacheCreationInputTokens: 500,
        cacheReadInputTokens: 7_500,
      },
    }))
    store.getState().updateTokenUsage("session-1", usage({
      totalTokens: 1_200,
      cacheReadInputTokens: 0,
    }))

    expect(store.getState().tokenUsages["session-1"]).toMatchObject({
      totalTokens: 1_200,
      cacheReadInputTokens: 7_500,
      cacheReadInputTokensRetained: true,
      prefixCache: {
        inputTokens: 2_000,
        cacheCreationInputTokens: 500,
        cacheReadInputTokens: 7_500,
        retainedFromPreviousRound: true,
      },
    })
  })

  it("replaces the retained value when a completed call reports a real zero hit", () => {
    const store = createStore<TokenBudgetSlice>()(createTokenBudgetSlice)

    store.getState().updateTokenUsage("session-1", usage({
      prefixCache: {
        inputTokens: 2_000,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 8_000,
      },
    }))
    store.getState().updateTokenUsage("session-1", usage({
      prefixCache: {
        inputTokens: 10_000,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      },
    }))

    expect(store.getState().tokenUsages["session-1"]).toMatchObject({
      cacheReadInputTokens: 0,
      cacheReadInputTokensRetained: false,
      prefixCache: {
        inputTokens: 10_000,
        cacheReadInputTokens: 0,
        retainedFromPreviousRound: false,
      },
    })
  })

  it("retains the last non-zero cache read from compatibility payloads", () => {
    const store = createStore<TokenBudgetSlice>()(createTokenBudgetSlice)

    store.getState().updateTokenUsage("legacy-session", usage({
      cacheReadInputTokens: 379_392,
    }))
    store.getState().updateTokenUsage("legacy-session", usage({
      totalTokens: 1_200,
      cacheReadInputTokens: 0,
    }))

    expect(store.getState().tokenUsages["legacy-session"]).toMatchObject({
      totalTokens: 1_200,
      cacheReadInputTokens: 379_392,
      cacheReadInputTokensRetained: true,
    })
  })
})
