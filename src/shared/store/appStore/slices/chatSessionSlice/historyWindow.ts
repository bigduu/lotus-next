import type { HistoryResponse } from "@services/chat/AgentService";
import type { ChatHistoryWindow, ChatItem, Message } from "@shared/types/chatMessages";
import { mapHistoryMessagesToUi } from "./messageMapping";

export const RECENT_HISTORY_PAGE = { limit: 100 } as const;

export interface HistoryPage {
  window: ChatHistoryWindow;
  messages: Message[];
  total: number;
}

export function readHistoryWindow(sessionId: string, history: HistoryResponse): HistoryPage | undefined {
  if (!Object.hasOwn(history, "next_before_message_id")) return undefined;
  const { total_message_count: total, history_start_index: start, next_before_message_id: cursor } = history;
  const messageIds = history.messages.map((message) => message.id);
  if (history.is_delta !== false || total === undefined || !Number.isSafeInteger(total)
    || start === undefined || !Number.isSafeInteger(start) || start < 0 || total < start + messageIds.length
    || cursor === undefined || messageIds.some((id) => typeof id !== "string" || !id)
    || (cursor === null ? start !== 0 : typeof cursor !== "string" || !cursor || start === 0 || !messageIds.length)) {
    throw new Error("Invalid history page");
  }
  return {
    window: { startIndex: start, messageIds, beforeMessageId: cursor },
    messages: mapHistoryMessagesToUi(sessionId, history.messages, start),
    total,
  };
}

export function historyMessageId(message: Message | undefined): string | null {
  if (message?.role === "assistant" && message.type === "text") {
    const id = message.metadata?.backendMessageId;
    if (typeof id === "string" && message.id === `${id}_text`) return id;
  }
  return message?.id ?? null;
}

export function prependHistoryPage(older: HistoryPage, newer: HistoryPage): HistoryPage | undefined {
  if (!older.window.messageIds.length || older.window.startIndex + older.window.messageIds.length !== newer.window.startIndex) return undefined;
  return {
    ...newer,
    window: { ...older.window, messageIds: [...older.window.messageIds, ...newer.window.messageIds] },
    messages: [...older.messages, ...newer.messages],
  };
}

export function extendHistoryWithDelta(chat: ChatItem, recent: HistoryPage, delta: HistoryResponse): HistoryPage | undefined {
  const previous = chat.historyWindow;
  if (!previous || delta.is_delta !== true) return undefined;
  const start = previous.startIndex + previous.messageIds.length;
  const overlapAt = recent.window.startIndex - start;
  // The legacy delta identifies a raw ID, so a reused ID can resolve to the
  // wrong occurrence. Require the exact expected length and recent suffix,
  // and use opaque paging if the delta starts inside a tool call/result group.
  if (overlapAt < 0 || delta.messages.length !== recent.total - start
    || delta.messages.find((message) => message.role !== "system")?.role === "tool"
    || recent.window.messageIds.some((id, index) => delta.messages[overlapAt + index]?.id !== id)) return undefined;
  return {
    ...recent,
    window: { ...previous, messageIds: [...previous.messageIds, ...delta.messages.map((message) => message.id)] },
    messages: [...chat.messages.filter((message) => message.historyIndex !== undefined && message.historyIndex < start),
      ...mapHistoryMessagesToUi(chat.id, delta.messages, start)],
  };
}

export function retainConfirmedHistory(chat: ChatItem, page: HistoryPage): HistoryPage {
  const previous = chat.historyWindow;
  const { window } = page;
  if (!previous) return page;
  const overlap = window.startIndex - previous.startIndex;
  // Confirm a stable occurrence at an overlapping visible position. IDs
  // alone cannot identify legacy records that reused the same message ID.
  const hasOverlap = overlap > 0 && window.messageIds.some((id, index) => previous.messageIds[overlap + index] === id);
  if (!hasOverlap) return page;
  return {
    ...page,
    window: { ...previous, messageIds: [...previous.messageIds.slice(0, overlap), ...window.messageIds] },
    messages: [...chat.messages.filter((message) => message.historyIndex !== undefined && message.historyIndex < window.startIndex),
      ...page.messages],
  };
}
