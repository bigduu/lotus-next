import { expect, it } from "vitest"
import type { Message } from "@shared/types/chatMessages"
import {
  collectLiveSessionFileChanges,
  collectSessionFileChanges,
  collectSubagentFileChanges,
  groupSessionFileChanges,
  mergeSessionFileChanges,
  orderPersistedFileChanges,
  summarizeSessionFileChangeGroups,
} from "./sessionFileChanges"

it("orders Root and child edits together while keeping different worktrees and remote files distinct", () => {
  const path = "src/app.ts"
  const payload = { operation: "Edit", file_path: path, diff: { unified: "+child edit" } }
  const childResult = {
    id: "same-id", role: "tool" as const, tool_call_id: "same-call", tool_success: true,
    content: JSON.stringify(payload), created_at: "2026-11-22T00:00:00.000000001Z",
  }
  const worker = { sessionId: "worker", title: "Worker", workspace: "/workspace", separateFileLocation: false }
  const childChanges = collectSubagentFileChanges([
    { ...childResult, role: "assistant" },
    { ...childResult, id: "failed-write", tool_success: false },
    childResult,
  ], worker)
  expect(childChanges).toHaveLength(1)
  expect(childChanges[0]?.source?.title).toBe("Worker")
  const worktree = collectSubagentFileChanges([childResult], { ...worker, sessionId: "worktree", workspace: "/other" })
  const remote = collectSubagentFileChanges([childResult], { ...worker, sessionId: "remote", separateFileLocation: true })
  const root = {
    id: "same-id", toolCallId: "same-call", payload, createdAt: "2026-11-22T00:00:00.000000002Z",
  }
  const groups = groupSessionFileChanges(orderPersistedFileChanges([
    root, ...childChanges, ...worktree, ...remote,
  ]), "/workspace")

  expect(groups).toHaveLength(3)
  expect(groups.find((group) => group.id === `file:/workspace/${path}`)?.changes.map((change) => change.id))
    .toEqual([childChanges[0]?.id, root.id])
  expect(groups.map((group) => group.filePath)).toEqual([`/other/${path}`, `/workspace/${path}`, `/workspace/${path}`])
})

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

it("groups repeated edits by normalized file path and aggregates their stats", () => {
  const changes = [
    {
      id: "first",
      payload: {
        operation: "edit",
        file_path: "C:\\workspace\\src\\app.tsx",
        diff: {
          unified: "--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new",
          added_lines: 1,
          removed_lines: 1,
        },
      },
    },
    {
      id: "second",
      payload: {
        operation: "edit",
        file_path: "C:/workspace/src/app.tsx",
        diff: {
          unified: "--- a\n+++ b\n@@ -2 +2,2 @@\n keep\n+more",
          added_lines: 1,
          removed_lines: 0,
          truncated: true,
        },
      },
    },
  ]

  const groups = groupSessionFileChanges(changes)

  expect(groups).toHaveLength(1)
  expect(groups[0]).toMatchObject({
    filePath: "C:/workspace/src/app.tsx",
    addedLines: 2,
    removedLines: 1,
    truncated: true,
  })
  expect(groups[0]?.changes.map((change) => change.id)).toEqual(["first", "second"])
})

it("groups relative and absolute reports for the same workspace file", () => {
  const changes = [
    {
      id: "absolute",
      payload: {
        operation: "edit",
        file_path: "/workspace/src/app.tsx",
        diff: { unified: "+first" },
      },
    },
    {
      id: "payload-workspace",
      payload: {
        operation: "edit",
        file_path: "src/app.tsx",
        workspace: "/workspace",
        diff: { unified: "+second" },
      },
    },
    {
      id: "session-workspace",
      payload: {
        operation: "edit",
        file_path: "./src/app.tsx",
        diff: { unified: "+third" },
      },
    },
  ]

  const groups = groupSessionFileChanges(changes, "/workspace")

  expect(groups).toHaveLength(1)
  expect(groups[0]?.filePath).toBe("/workspace/src/app.tsx")
  expect(groups[0]?.changes.map((change) => change.id)).toEqual([
    "absolute",
    "payload-workspace",
    "session-workspace",
  ])
})

it("normalizes macOS private temporary-directory aliases", () => {
  const groups = groupSessionFileChanges(
    [
      {
        id: "tmp",
        payload: {
          operation: "edit",
          file_path: "/tmp/project/app.ts",
          diff: { unified: "+first" },
        },
      },
      {
        id: "private-tmp",
        payload: {
          operation: "edit",
          file_path: "app.ts",
          diff: { unified: "+second" },
        },
      },
    ],
    "/private/tmp/project",
  )

  expect(groups).toHaveLength(1)
  expect(groups[0]?.filePath).toBe("/tmp/project/app.ts")
})

it("orders file groups by their latest edit and summarizes unique files separately from edits", () => {
  const makeChange = (id: string, filePath: string, added: number, removed: number) => ({
    id,
    payload: {
      operation: "edit",
      file_path: filePath,
      diff: {
        unified: `--- a\n+++ b\n@@ -1 +1 @@\n-${"old".repeat(removed)}\n+${"new".repeat(added)}`,
        added_lines: added,
        removed_lines: removed,
      },
    },
  })
  const groups = groupSessionFileChanges([
    makeChange("a-1", "/workspace/a.ts", 1, 1),
    makeChange("b-1", "/workspace/b.ts", 3, 0),
    makeChange("a-2", "/workspace/a.ts", 2, 1),
  ])

  expect(groups.map((group) => group.filePath)).toEqual([
    "/workspace/b.ts",
    "/workspace/a.ts",
  ])
  expect(summarizeSessionFileChangeGroups(groups)).toEqual({
    fileCount: 2,
    editCount: 3,
    addedLines: 6,
    removedLines: 2,
  })
})
