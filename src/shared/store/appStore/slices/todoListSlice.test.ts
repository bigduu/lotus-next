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
    const child = taskList("work-child", "in_progress", 47)
    store.getState().setTaskList("supervisor", root)
    store.getState().setTaskList("work-child", child)
    let respond!: (value: TaskList) => void
    api.get.mockReturnValue(new Promise<TaskList>((resolve) => { respond = resolve }))

    const reload = store.getState().loadTaskList("work-child")
    store.getState().updateTaskListDelta("work-child", {
      session_id: "work-child", item_id: "read", status: "completed", tool_calls_count: 3, version: 49,
    })
    respond(taskList("work-child", "in_progress", 48))
    await reload
    store.getState().setTaskList("work-child", taskList("work-child", "pending", 47))

    expect(store.getState().taskLists.supervisor).toEqual(root)
    expect(store.getState().taskLists["work-child"].items[0].status).toBe("completed")
    expect(store.getState().getTaskListVersion("work-child")).toBe(49)
  })

  it("keeps live progress when a committed plan resets the version during an HTTP read", async () => {
    const store = createStore<TaskListSlice>()(createTaskListSlice)
    store.getState().setTaskList("work-child", taskList("work-child", "pending", 2))
    store.getState().updateTaskListDelta("work-child", {
      session_id: "work-child", item_id: "read", status: "in_progress", tool_calls_count: 3, version: 5,
    })
    let respond!: (value: TaskList) => void
    api.get.mockReturnValue(new Promise<TaskList>((resolve) => { respond = resolve }))

    const reload = store.getState().loadTaskList("work-child")
    store.getState().setTaskList("work-child", taskList("work-child", "pending", 3))
    store.getState().updateTaskListDelta("work-child", {
      session_id: "work-child", item_id: "read", status: "completed", tool_calls_count: 2, version: 5,
    })
    respond(taskList("work-child", "in_progress", 4))
    await reload

    expect(store.getState().taskLists["work-child"].items[0].status).toBe("completed")
    expect(store.getState().getTaskListVersion("work-child")).toBe(5)
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

  it("replaces provisional tool progress with a newer committed Work plan", () => {
    const store = createStore<TaskListSlice>()(createTaskListSlice)
    store.getState().setTaskList("work-child", taskList("work-child", "in_progress", 2))
    store.getState().updateTaskListDelta("work-child", {
      session_id: "work-child", item_id: "read", status: "blocked", tool_calls_count: 15, version: 17,
    })
    const committed = taskList("work-child", "completed", 3)

    store.getState().setTaskList("work-child", committed)

    expect(store.getState().taskLists["work-child"]).toEqual(committed)
    expect(store.getState().getTaskListVersion("work-child")).toBe(3)
  })

  it("recovers a missed committed Work plan by reading a fresh snapshot", async () => {
    const store = createStore<TaskListSlice>()(createTaskListSlice)
    store.getState().setTaskList("work-child", taskList("work-child", "in_progress", 2))
    store.getState().updateTaskListDelta("work-child", {
      session_id: "work-child", item_id: "read", status: "blocked", tool_calls_count: 15, version: 17,
    })
    const committed = taskList("work-child", "completed", 3)
    api.get.mockResolvedValue(committed)

    await store.getState().loadTaskList("work-child")

    expect(store.getState().taskLists["work-child"]).toEqual(committed)
    expect(store.getState().getTaskListVersion("work-child")).toBe(3)
  })

  it("recovers an already missed Work commit while provisional progress continues", async () => {
    const store = createStore<TaskListSlice>()(createTaskListSlice)
    store.getState().setTaskList("work-child", taskList("work-child", "in_progress", 2))
    store.getState().updateTaskListDelta("work-child", {
      session_id: "work-child", item_id: "read", status: "blocked", tool_calls_count: 15, version: 17,
    })
    let respond!: (value: TaskList) => void
    api.get.mockReturnValue(new Promise<TaskList>((resolve) => { respond = resolve }))

    const reload = store.getState().loadTaskList("work-child")
    store.getState().updateTaskListDelta("work-child", {
      session_id: "work-child", item_id: "read", status: "in_progress", tool_calls_count: 16, version: 18,
    })
    const committed = taskList("work-child", "completed", 3)
    respond(committed)
    await reload

    expect(store.getState().taskLists["work-child"]).toEqual(committed)
    expect(store.getState().getTaskListVersion("work-child")).toBe(3)
  })

  it("recovers a missed plan even when the first live progress arrives during the read", async () => {
    const store = createStore<TaskListSlice>()(createTaskListSlice)
    store.getState().setTaskList("work-child", taskList("work-child", "pending", 2))
    const committed = taskList("work-child", "completed", 3)
    committed.items.push({
      ...committed.items[0], id: "report", description: "Record evidence", status: "pending",
    })
    let respond!: (value: TaskList) => void
    api.get.mockReturnValueOnce(new Promise<TaskList>((resolve) => { respond = resolve }))
      .mockResolvedValueOnce(committed)

    const reload = store.getState().loadTaskList("work-child")
    store.getState().updateTaskListDelta("work-child", {
      session_id: "work-child", item_id: "read", status: "in_progress", tool_calls_count: 2, version: 4,
    })
    respond(committed)
    await reload

    expect(store.getState().taskLists["work-child"]).toEqual(committed)
    expect(store.getState().getTaskListVersion("work-child")).toBe(3)
    expect(api.get).toHaveBeenCalledTimes(2)
  })
})
