import { StateCreator } from "zustand";
import { TokenUsage } from "@shared/types/tokenBudget";

export interface TokenBudgetState {
  // Map of chat ID to token usage
  tokenUsages: Record<string, TokenUsage>;
  // Map of chat ID to truncation flag
  truncationOccurred: Record<string, boolean>;
  // Map of chat ID to segments removed count
  segmentsRemoved: Record<string, number>;
}

export interface TokenBudgetActions {
  updateTokenUsage: (sessionId: string, usage: TokenUsage) => void;
  setTruncationInfo: (
    sessionId: string,
    truncationOccurred: boolean,
    segmentsRemoved: number,
  ) => void;
  clearTokenUsage: (sessionId: string) => void;
}

export type TokenBudgetSlice = TokenBudgetState & TokenBudgetActions;

export const createTokenBudgetSlice: StateCreator<TokenBudgetSlice, [], [], TokenBudgetSlice> = (
  set,
) => ({
  tokenUsages: {},
  truncationOccurred: {},
  segmentsRemoved: {},

  updateTokenUsage: (sessionId, usage) =>
    set((state) => {
      const previous = state.tokenUsages[sessionId];
      let nextUsage = usage;

      if (usage.prefixCache) {
        const retainedFromPreviousRound = Boolean(
          usage.prefixCache.retainedFromPreviousRound,
        );
        nextUsage = {
          ...usage,
          cacheReadInputTokens: usage.prefixCache.cacheReadInputTokens,
          cacheReadInputTokensRetained: retainedFromPreviousRound,
          prefixCache: {
            ...usage.prefixCache,
            retainedFromPreviousRound,
          },
        };
      } else if (previous?.prefixCache) {
        // Bamboo emits a prompt-budget snapshot before each provider call. It
        // intentionally has no completed provider usage, so keep the previous
        // completed call visible instead of flashing a fake Cache 0%.
        nextUsage = {
          ...usage,
          cacheReadInputTokens: previous.prefixCache.cacheReadInputTokens,
          cacheReadInputTokensRetained: true,
          prefixCache: {
            ...previous.prefixCache,
            retainedFromPreviousRound: true,
          },
        };
      } else if (
        (usage.cacheReadInputTokens ?? 0) === 0 &&
        (previous?.cacheReadInputTokens ?? 0) > 0
      ) {
        // Compatibility with older Bamboo versions that only expose the raw
        // cache-read counter and cannot distinguish preflight from completion.
        nextUsage = {
          ...usage,
          cacheReadInputTokens: previous?.cacheReadInputTokens,
          cacheReadInputTokensRetained: true,
        };
      } else if (typeof usage.cacheReadInputTokens === "number") {
        nextUsage = { ...usage, cacheReadInputTokensRetained: false };
      }

      return {
        tokenUsages: {
          ...state.tokenUsages,
          [sessionId]: nextUsage,
        },
      };
    }),

  setTruncationInfo: (sessionId, truncationOccurred, segmentsRemoved) =>
    set((state) => ({
      truncationOccurred: {
        ...state.truncationOccurred,
        [sessionId]: truncationOccurred,
      },
      segmentsRemoved: {
        ...state.segmentsRemoved,
        [sessionId]: segmentsRemoved,
      },
    })),

  clearTokenUsage: (sessionId) =>
    set((state) => {
      const { [sessionId]: _, ...remainingUsages } = state.tokenUsages;
      const { [sessionId]: __, ...remainingTruncation } = state.truncationOccurred;
      const { [sessionId]: ___, ...remainingSegments } = state.segmentsRemoved;
      return {
        tokenUsages: remainingUsages,
        truncationOccurred: remainingTruncation,
        segmentsRemoved: remainingSegments,
      };
    }),
});
