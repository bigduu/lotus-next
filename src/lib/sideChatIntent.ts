import type { SideChatQuote } from "@services/chat/sideChat"

export type SideChatIntent = { prompt?: string; quote?: SideChatQuote; onApplied?: () => void }
export type PendingSideChatIntent = SideChatIntent & { token: number }
