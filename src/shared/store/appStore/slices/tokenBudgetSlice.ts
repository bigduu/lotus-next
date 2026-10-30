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

/** A durable snapshot does not create a new live-event revision. */
type TokenMutationOptions = { fromSnapshot?: boolean };

export interface TokenBudgetActions {
  updateTokenUsage: (sessionId: string, usage: TokenUsage, options?: TokenMutationOptions) => void;
  setTruncationInfo: (
    sessionId: string,
    truncationOccurred: boolean,
    segmentsRemoved: number,
    options?: TokenMutationOptions,
  ) => void;
  clearTokenUsage: (sessionId: string) => void;
  clearTokenUsageValue: (sessionId: string, options?: TokenMutationOptions) => void;
  clearTruncationInfo: (sessionId: string, options?: TokenMutationOptions) => void;
}

export type TokenBudgetSlice = TokenBudgetState & TokenBudgetActions;

// A clear-recovery read may be waiting on a separate target confirmation.
// Track later token events per store/session without treating an unrelated
// session's update as a change to this one.
type TokenRevisions = { usage: number; truncation: number };
const tokenRevisions = new WeakMap<() => TokenBudgetSlice, Map<string, TokenRevisions>>();
export const tokenBudgetRevision = (get: () => TokenBudgetSlice, sessionId: string): TokenRevisions =>
  tokenRevisions.get(get)?.get(sessionId) ?? { usage: 0, truncation: 0 };
const advanceTokenBudgetRevision = (get: () => TokenBudgetSlice, sessionId: string, group: keyof TokenRevisions): void => {
  const revisions = tokenRevisions.get(get) ?? new Map<string, TokenRevisions>();
  const previous = tokenBudgetRevision(get, sessionId);
  revisions.set(sessionId, { ...previous, [group]: previous[group] + 1 });
  tokenRevisions.set(get, revisions);
};

export const createTokenBudgetSlice: StateCreator<TokenBudgetSlice, [], [], TokenBudgetSlice> = (
  set, get,
) => ({
  tokenUsages: {},
  truncationOccurred: {},
  segmentsRemoved: {},

  updateTokenUsage: (sessionId, usage, options) => {
    if (!options?.fromSnapshot) advanceTokenBudgetRevision(get, sessionId, "usage");
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
    });
  },

  setTruncationInfo: (sessionId, truncationOccurred, segmentsRemoved, options) => {
    if (!options?.fromSnapshot) advanceTokenBudgetRevision(get, sessionId, "truncation");
    set((state) => ({
      truncationOccurred: {
        ...state.truncationOccurred,
        [sessionId]: truncationOccurred,
      },
      segmentsRemoved: {
        ...state.segmentsRemoved,
        [sessionId]: segmentsRemoved,
      },
    }));
  },

  clearTokenUsageValue: (sessionId, options) => {
    if (!options?.fromSnapshot) advanceTokenBudgetRevision(get, sessionId, "usage");
    set((state) => {
      const { [sessionId]: _, ...tokenUsages } = state.tokenUsages;
      return { tokenUsages };
    });
  },

  clearTruncationInfo: (sessionId, options) => {
    if (!options?.fromSnapshot) advanceTokenBudgetRevision(get, sessionId, "truncation");
    set((state) => {
      const { [sessionId]: _, ...truncationOccurred } = state.truncationOccurred;
      const { [sessionId]: __, ...segmentsRemoved } = state.segmentsRemoved;
      return { truncationOccurred, segmentsRemoved };
    });
  },

  clearTokenUsage: (sessionId) => {
    advanceTokenBudgetRevision(get, sessionId, "usage");
    advanceTokenBudgetRevision(get, sessionId, "truncation");
    set((state) => {
      const { [sessionId]: _, ...remainingUsages } = state.tokenUsages;
      const { [sessionId]: __, ...remainingTruncation } = state.truncationOccurred;
      const { [sessionId]: ___, ...remainingSegments } = state.segmentsRemoved;
      return {
        tokenUsages: remainingUsages,
        truncationOccurred: remainingTruncation,
        segmentsRemoved: remainingSegments,
      };
    });
  },
});
