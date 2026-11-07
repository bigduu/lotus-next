import { beforeEach, describe, expect, it, vi } from "vitest"
import { createStore } from "zustand/vanilla"

const api = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock("@services/api", () => ({ apiClient: api }))

import { createTaskListSlice, type TaskItemStatus, type TaskList, type TaskListSlice } from "./todoListSlice"

function taskList(sessionId: string, status: TaskItemStatus, version?: number): TaskList {
  return {
    session_id: sessionId,
    title: `Plan for ${sessionId}`,
    items: [{ id: "read", description: "Verify the source", status, depends_on: [], notes: "" }],
    created_at: "2026-11-07T02:39:39Z",
    updated_at: "2026-11-07T02:45:11Z",
    ...(version !== undefined ? { version } : {}),
  }
}

describe("Task snapshots and live progress", () => {
  beforeEach(() => api.get.mockReset())

  it("keeps the reconnect snapshot's version and rejects an older progress event", async () => {
    const store = createStore<TaskListSlice>()(createTaskListSlice)
    const snapshot = taskList("work-child", "completed", 48)
    api.get.mockResolvedValue(snapshot)

    await store.getState().loadTaskList("work-child")
    store.getState().updateTaskListDelta("work-child", {
      session_id: "work-child", item_id: "read", status: "in_progress", tool_calls_count: 2, version: 47,
    })

    expect(store.getState().taskLists["work-child"]).toEqual(snapshot)
    expect(store.getState().getTaskListVersion("work-child")).toBe(48)
  })

  it("keeps a newer Worker update when an older HTTP response or full event arrives", async () => {
    const store = createStore<TaskListSlice>()(createTaskListSlice)
    const root = taskList("supervisor", "blocked", 1491)
    const child = taskList("work-child", "in_progress", 48)
    store.getState().setTaskList("supervisor", root)
    store.getState().setTaskList("work-child", child)
    let respond!: (value: TaskList) => void
    api.get.mockReturnValue(new Promise<TaskList>((resolve) => { respond = resolve }))

    const reload = store.getState().loadTaskList("work-child")
    store.getState().updateTaskListDelta("work-child", {
      session_id: "work-child", item_id: "read", status: "completed", tool_calls_count: 3, version: 49,
    })
    respond(child)
    await reload
    store.getState().setTaskList("work-child", taskList("work-child", "pending", 47))

    expect(store.getState().taskLists.supervisor).toEqual(root)
    expect(store.getState().taskLists["work-child"].items[0].status).toBe("completed")
    expect(store.getState().getTaskListVersion("work-child")).toBe(49)
  })

  it("accepts legacy unversioned lists until a versioned update and after an explicit reset", () => {
    const store = createStore<TaskListSlice>()(createTaskListSlice)
    const legacy = taskList("work-child", "pending")
    store.getState().setTaskList("work-child", legacy)
    expect(store.getState().taskLists["work-child"]).toEqual(legacy)

    store.getState().setTaskList("work-child", taskList("work-child", "completed", 1))
    store.getState().setTaskList("work-child", legacy)
    expect(store.getState().taskLists["work-child"].items[0].status).toBe("completed")

    store.getState().clearTaskList("work-child")
    store.getState().setTaskList("work-child", legacy)
    expect(store.getState().taskLists["work-child"]).toEqual(legacy)
  })
})
