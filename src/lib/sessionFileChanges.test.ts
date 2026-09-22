import { expect, it } from "vitest"
import type { Message } from "@shared/types/chatMessages"
import {
  collectLiveSessionFileChanges,
  collectSessionFileChanges,
  mergeSessionFileChanges,
} from "./sessionFileChanges"

it("collects only structured file-edit results in transcript order", () => {
  const fileResult = JSON.stringify({
    operation: "edit",
    file_path: "/workspace/src/app.tsx",
    diff: {
      unified: "--- a/src/app.tsx\n+++ b/src/app.tsx\n@@ -1 +1 @@\n-old\n+new",
      added_lines: 1,
      removed_lines: 1,
    },
  })
  const messages = [
    { id: "plain", role: "assistant", type: "text", content: "done" },
    { id: "not-a-diff", role: "tool", type: "tool_result", result: { result: "ok" } },
    { id: "edit", role: "tool", type: "tool_result", result: { result: fileResult } },
  ] as unknown as Message[]

  const changes = collectSessionFileChanges(messages)

  expect(changes).toHaveLength(1)
  expect(changes[0]?.id).toBe("edit")
  expect(changes[0]?.payload.file_path).toBe("/workspace/src/app.tsx")
})

it("collects live file edits without duplicating an overlapping persisted result", () => {
  const persistedResult = JSON.stringify({
    operation: "edit",
    file_path: "/workspace/src/app.tsx",
    diff: { unified: "--- a\n+++ b\n@@ -1 +1 @@\n-old\n+persisted" },
  })
  const liveResult = JSON.stringify({
    operation: "edit",
    file_path: "/workspace/src/app.tsx",
    diff: { unified: "--- a\n+++ b\n@@ -1 +1 @@\n-old\n+live" },
  })
  const persisted = collectSessionFileChanges([
    {
      id: "persisted",
      role: "tool",
      type: "tool_result",
      toolCallId: "edit-1",
      result: { result: persistedResult },
    },
  ] as unknown as Message[])
  const live = collectLiveSessionFileChanges([
    {
      kind: "tools",
      calls: [{ toolCallId: "edit-1", output: liveResult }],
    },
  ])

  const changes = mergeSessionFileChanges(persisted, live)

  expect(changes).toHaveLength(1)
  expect(changes[0]?.id).toBe("persisted")
  expect(changes[0]?.payload.diff.unified).toContain("+persisted")
})
