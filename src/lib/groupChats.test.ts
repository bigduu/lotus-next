import { describe, expect, it } from "vitest"
import type { ChatItem } from "@shared/types/chatMessages"
import { groupChats, groupChatsByProject } from "./groupChats"
import type { SessionOrder } from "./sidebarSessionOrder"

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

  it("keeps pinned separate and sorts populated dates and rows by creation time", () => {
    const chats = [
      chat("older", "2026-08-01T12:00:00"),
      // Backend activity/updatedAt must not move a session out of its creation day.
      chat("updated", "2026-08-01T13:00:00", { updatedAt: "2026-09-03T15:00:00", lastActivityAt: "2026-09-03T16:00:00" }),
      chat("created-later", "2026-08-02T09:00:00", { lastActivityAt: "2026-08-01T10:00:00" }),
      chat("pinned", "2026-07-01T12:00:00", { pinned: true }),
    ]
    expect(groupChats(chats, new Date("2026-09-05T15:00:00")).map((group) => ({
      key: group.key, ids: group.chats.map((c) => c.id),
    }))).toEqual([
      { key: "__pinned", ids: ["pinned"] },
      { key: "2026-08-02", ids: ["created-later"] },
      { key: "2026-08-01", ids: ["updated", "older"] },
    ])
    expect(chats.map((c) => c.id)).toEqual(["older", "updated", "created-later", "pinned"])
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

  it("moves a session into today once the user writes into it", () => {
    const chats = [chat("written", "2026-08-01T12:00:00"), chat("today", "2026-09-05T09:00:00")]
    const order: SessionOrder = {
      version: 1,
      ranks: { written: 1 },
      activity: { written: new Date("2026-09-05T14:00:00").getTime() },
    }
    expect(groupChats(chats, new Date("2026-09-05T15:00:00"), order).map((group) => ({
      key: group.key, ids: group.chats.map((c) => c.id),
    }))).toEqual([{ key: "2026-09-05", ids: ["written", "today"] }])
    // Without the recorded submission nothing moves.
    expect(groupChats(chats, new Date("2026-09-05T15:00:00")).map((group) => group.key))
      .toEqual(["2026-09-05", "2026-08-01"])
  })

  it("keeps a manual drag position inside its project group", () => {
    const chats = [
      chat("newest", "2026-09-05T12:00:00", { config: { systemPromptId: "", baseSystemPrompt: "", lastUsedEnhancedPrompt: null, projectId: "p1" } }),
      chat("older", "2026-09-01T12:00:00", { config: { systemPromptId: "", baseSystemPrompt: "", lastUsedEnhancedPrompt: null, projectId: "p1" } }),
    ]
    const order: SessionOrder = { version: 1, ranks: { older: 2, newest: 1 }, activity: {} }
    expect(groupChatsByProject(chats, () => "p1", order)[0]!.chats.map((c) => c.id)).toEqual(["older", "newest"])
  })

  it("never lets a touch yesterday push Yesterday above Today", () => {
    // The user wrote into an old session late yesterday, so it keeps a finite
    // rank and the newest activity, but its day is still yesterday.
    const order: SessionOrder = {
      version: 1,
      ranks: { yesterday: 9, today: 1 },
      activity: { yesterday: new Date("2026-09-04T22:00:00").getTime() },
    }
    const chats = [chat("yesterday", "2026-08-01T12:00:00"), chat("today", "2026-09-05T09:00:00")]
    expect(groupChats(chats, new Date("2026-09-05T15:00:00"), order).map((group) => ({
      key: group.key, ids: group.chats.map((c) => c.id),
    }))).toEqual([
      { key: "2026-09-05", ids: ["today"] },
      { key: "2026-09-04", ids: ["yesterday"] },
    ])
  })

  it("keeps Project order stable when a session inside one Project moves", () => {
    const project = (id: string) => ({ systemPromptId: "", baseSystemPrompt: "", lastUsedEnhancedPrompt: null, projectId: id })
    const chats = [
      chat("p1-new", "2026-09-05T12:00:00", { config: project("p1") }),
      chat("p2-old", "2026-09-01T12:00:00", { config: project("p2") }),
    ]
    // Dragging p2's only session to the top of its group must not lift Project 2
    // above Project 1: Projects stay ordered by their newest created session.
    const order: SessionOrder = { version: 1, ranks: { "p2-old": 5, "p1-new": 1 }, activity: {} }
    expect(groupChatsByProject(chats, (id) => id ?? "unassigned", order).map((group) => group.key)).toEqual(["p1", "p2"])
  })
})
