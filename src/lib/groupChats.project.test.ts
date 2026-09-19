import { describe, expect, it } from "vitest"
import { groupChatsByProject, type ChatGroup } from "./groupChats"
import { NO_PROJECT_GROUP_KEY } from "@services/project"
import type { ChatItem } from "@shared/types/chatMessages"

const chat = (id: string, projectId?: string | null, pinned = false): ChatItem =>
  ({
    id,
    kind: "root",
    title: id,
    createdAt: 1_000,
    pinned,
    messages: [],
    config: {
      systemPromptId: "default",
      baseSystemPrompt: "",
      lastUsedEnhancedPrompt: null,
      projectId: projectId ?? null,
    },
  }) as unknown as ChatItem

describe("groupChatsByProject", () => {
  it("groups assigned sessions by project id and unassigned last", () => {
    const groups = groupChatsByProject(
      [chat("a", "p1"), chat("b", null), chat("c", "p2"), chat("d", "p1")],
      (id) => (id ? `Project ${id}` : "未分配"),
    )

    expect(groups.map((g: ChatGroup) => g.key)).toEqual(["p1", "p2", NO_PROJECT_GROUP_KEY])
    expect(groups[0].chats.map((c) => c.id)).toEqual(["a", "d"])
    expect(groups[1].chats.map((c) => c.id)).toEqual(["c"])
    expect(groups[2].label).toBe("未分配")
  })

  it("keeps pinned sessions in a leading group regardless of project", () => {
    const groups = groupChatsByProject(
      [chat("pinned", "p1", true), chat("a", "p1")],
      (id) => id ?? "未分配",
    )

    expect(groups[0].key).toBe("__pinned")
    expect(groups[0].chats.map((c) => c.id)).toEqual(["pinned"])
    expect(groups[1].key).toBe("p1")
    expect(groups[1].chats.map((c) => c.id)).toEqual(["a"])
  })

  it("treats blank project ids as unassigned", () => {
    const groups = groupChatsByProject(
      [chat("a", "  "), chat("b", undefined)],
      (id) => id ?? "未分配",
    )

    expect(groups).toHaveLength(1)
    expect(groups[0].key).toBe(NO_PROJECT_GROUP_KEY)
    expect(groups[0].chats.map((c) => c.id)).toEqual(["a", "b"])
  })
})
