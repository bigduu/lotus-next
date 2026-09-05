import { describe, expect, it } from "vitest"
import type { ChatItem } from "@shared/types/chatMessages"
import { groupChats } from "./groupChats"

function chat(id: string, date: string, extra: Partial<ChatItem> = {}): ChatItem {
  return {
    id, title: id, createdAt: new Date(date).getTime(), messages: [],
    config: { systemPromptId: "", baseSystemPrompt: "", lastUsedEnhancedPrompt: null },
    ...extra,
  }
}

describe("groupChats", () => {
  it("keeps calendar keys stable when relative date labels change", () => {
    const chats = [chat("recent", "2026-09-05T12:00:00"), chat("previous", "2026-09-04T12:00:00")]
    const today = groupChats(chats, new Date("2026-09-05T15:00:00"))
    const tomorrow = groupChats(chats, new Date("2026-09-06T15:00:00"))
    expect(today.map(({ key, label }) => ({ key, label }))).toEqual([
      { key: "2026-09-05", label: "今天" }, { key: "2026-09-04", label: "昨天" },
    ])
    expect(tomorrow.map(({ key, label }) => ({ key, label }))).toEqual([
      { key: "2026-09-05", label: "昨天" }, { key: "2026-09-04", label: "9月4日" },
    ])
  })

  it("keeps pinned separate and sorts populated dates and rows by latest activity", () => {
    const chats = [
      chat("older", "2026-08-01T12:00:00"),
      chat("updated", "2026-08-01T12:00:00", { updatedAt: "2026-09-03T15:00:00" }),
      chat("active", "2026-08-01T12:00:00", { updatedAt: "2026-09-05T15:00:00", lastActivityAt: "2026-09-03T16:00:00" }),
      chat("pinned", "2026-07-01T12:00:00", { pinned: true }),
    ]
    expect(groupChats(chats, new Date("2026-09-05T15:00:00")).map((group) => ({
      key: group.key, ids: group.chats.map((c) => c.id),
    }))).toEqual([
      { key: "__pinned", ids: ["pinned"] },
      { key: "2026-09-03", ids: ["active", "updated"] },
      { key: "2026-08-01", ids: ["older"] },
    ])
    expect(chats.map((c) => c.id)).toEqual(["older", "updated", "active", "pinned"])
  })

  it("uses local calendar dates across midnight and year boundaries", () => {
    const groups = groupChats([
      chat("new-year", "2026-01-01T00:01:00"),
      chat("last-year", "2025-12-31T23:59:00"),
      chat("older-year", "2024-12-31T23:59:00"),
    ], new Date("2026-01-01T12:00:00"))
    expect(groups.map(({ key, label }) => ({ key, label }))).toEqual([
      { key: "2026-01-01", label: "今天" },
      { key: "2025-12-31", label: "昨天" },
      { key: "2024-12-31", label: "2024年12月31日" },
    ])
  })

  it("returns no groups for an empty list", () => {
    expect(groupChats([], new Date())).toEqual([])
  })
})
