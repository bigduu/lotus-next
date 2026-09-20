import { expect, it } from "vitest"
import type { Message } from "@shared/types/chatMessages"
import { collectSessionFileChanges } from "./sessionFileChanges"

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
