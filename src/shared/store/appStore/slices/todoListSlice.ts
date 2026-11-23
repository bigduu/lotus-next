import { StateCreator } from "zustand";

import { AgentClient, type TaskItem as SessionTaskItem, type TaskListDelta } from "@services/chat/AgentService";

export type { TaskItemStatus, TaskListDelta } from "@services/chat/AgentService";

// Task item
export interface TaskItem extends SessionTaskItem {
  tool_calls_count?: number; // NEW: number of tool calls
  summary?: string; // Concise summary of what was accomplished (for completed tasks)
}

// Task list
export interface TaskList {
  session_id: string;
  title: string;
  items: TaskItem[];
  created_at: string;
  updated_at: string;
  version?: number;
}

// Progress info
export interface TaskProgress {
  completed: number;
  total: number;
  percentage: number;
}

export interface TaskListState {
  // Map of session ID to task list
  taskLists: Record<string, TaskList>;
  // Map of session ID to version (for conflict detection)
  taskListVersions: Record<string, number>;
  // Map of session ID to active item ID
  activeItems: Record<string, string | null>;
  // Map of session ID to evaluation state (NEW)
  evaluationStates: Record<string, EvaluationState>;
}

// Evaluation state (NEW)
export interface EvaluationState {
  isEvaluating: boolean;
  reasoning: string | null;
  timestamp: number | null;
}

export interface TaskListActions {
  // Set full task list (from TaskListUpdated event)
  setTaskList: (sessionId: string, taskList: TaskList) => void;
  // Load the current task list snapshot from backend (best effort)
  loadTaskList: (sessionId: string) => Promise<TaskList | null>;
  // Update from delta (from TaskListItemProgress event)
  updateTaskListDelta: (sessionId: string, delta: TaskListDelta) => void;
  // Clear task list for a session
  clearTaskList: (sessionId: string) => void;
  // Get current version
  getTaskListVersion: (sessionId: string) => number;
  // Set evaluation state (NEW)
  setEvaluationState: (sessionId: string, state: EvaluationState) => void;
  // Clear evaluation state (NEW)
  clearEvaluationState: (sessionId: string) => void;
}

export type TaskListSlice = TaskListState & TaskListActions;

const agentClient = AgentClient.getInstance();

function withTaskProgress(item: TaskItem, delta: TaskListDelta): TaskItem {
  return { ...item, status: delta.status, tool_calls_count: delta.tool_calls_count };
}

export const createTaskListSlice: StateCreator<TaskListSlice, [], [], TaskListSlice> = (
  set,
  get,
) => {
  const progressBySession = new Map<string, Map<string, TaskListDelta>>();
  const missingDuringRead = new Map<string, Set<string>>();
  return {
    // State
    taskLists: {},
    taskListVersions: {},
    activeItems: {},
    evaluationStates: {},

    // A newer full list can supersede provisional progress from a tool run.
    setTaskList: (sessionId, taskList) =>
      set((state) => {
        const version = taskList.version ?? 0;
        const previousSnapshotVersion = state.taskLists[sessionId]?.version;
        const observedVersion = state.taskListVersions[sessionId] ?? 0;
        if (previousSnapshotVersion !== undefined && (
          version < previousSnapshotVersion ||
          (version === previousSnapshotVersion && version < observedVersion)
        )) {
          return state;
        }
        // A snapshot containing a missing task can restore the topology while
        // tool progress from that same recovery is already ahead of the read.
        const missing = missingDuringRead.get(sessionId);
        const progress = progressBySession.get(sessionId);
        const replayed = new Map<string, TaskListDelta>();
        let restoredList = taskList;
        let latestDelta: TaskListDelta | undefined;
        if (progress && missing && taskList.items.some((item) => missing.has(item.id))) {
          const items = [...taskList.items];
          for (const [index, item] of taskList.items.entries()) {
            const delta = progress.get(item.id);
            if (!delta || delta.version <= version) continue;
            items[index] = withTaskProgress(item, delta);
            replayed.set(item.id, delta);
            if (!latestDelta || delta.version > latestDelta.version) latestDelta = delta;
          }
          if (latestDelta) restoredList = { ...taskList, items, updated_at: new Date().toISOString() };
        }
        // Consume the missing-task evidence on admission. A subsequent full
        // plan retains its own statuses even while the original read settles.
        missing?.clear();
        if (replayed.size) progressBySession.set(sessionId, replayed);
        else progressBySession.delete(sessionId);
        return {
          taskLists: {
            ...state.taskLists,
            [sessionId]: restoredList,
          },
          taskListVersions: {
            ...state.taskListVersions,
            [sessionId]: latestDelta?.version ?? version,
          },
          ...(latestDelta && { activeItems: {
            ...state.activeItems,
            [sessionId]: latestDelta.status === "in_progress" ? latestDelta.item_id : null,
          } }),
        };
      }),

    loadTaskList: async (sessionId) => {
      let latest: TaskList | null = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const { taskLists: listsAtRequest, taskListVersions: versionsAtRequest } = get();
        const request = agentClient.getTaskList(sessionId);
        const taskList = await (attempt === 0 ? request : request.catch(() => null));
        if (!taskList) break;
        latest = taskList;
        const owner = taskList.session_id || sessionId;
        const state = get();
        const version = taskList.version;
        const previous = listsAtRequest[owner];
        const current = state.taskLists[owner];
        const observed = state.getTaskListVersion(owner);
        // Compare immutable lists because a commit can reset the progress version.
        const progressedDuringRequest = current !== previous;
        const committedAtRequest = previous?.version;
        const recoversMissedPlan = version !== undefined && committedAtRequest !== undefined &&
          current?.version === committedAtRequest &&
          version > committedAtRequest && version <= (versionsAtRequest[owner] ?? 0);
        if (!progressedDuringRequest || version === undefined || version >= observed || recoversMissedPlan) {
          state.setTaskList(owner, taskList);
          break;
        }
        // An overtaken response can still reveal a missed commit. Recheck once
        // from the new baseline; never replace newer live progress on this reply.
        if (current?.version === undefined || version <= current.version) break;
      }
      return latest;
    },

    // Update from delta (from TaskListItemProgress event)
    updateTaskListDelta: (sessionId, delta) => {
      if (delta.session_id !== sessionId) return;
      const current = get();
      const list = current.taskLists[sessionId];
      if (delta.version <= (list?.version ?? 0)) return;
      const itemIndex = list?.items.findIndex((item) => item.id === delta.item_id) ?? -1;
      const progress = progressBySession.get(sessionId) ?? new Map<string, TaskListDelta>();
      const bufferedVersion = progress.get(delta.item_id)?.version ?? 0;
      if (delta.version > bufferedVersion) progress.set(delta.item_id, delta);
      progressBySession.set(sessionId, progress);
      if (list && itemIndex >= 0) {
        if (delta.version <= current.getTaskListVersion(sessionId)) return;
        const items = [...list.items];
        items[itemIndex] = withTaskProgress(items[itemIndex]!, delta);
        set((state) => ({
          taskLists: {
            ...state.taskLists,
            [sessionId]: {
              ...list,
              items,
              updated_at: new Date().toISOString(),
            },
          },
          taskListVersions: {
            ...state.taskListVersions,
            [sessionId]: delta.version,
          },
          activeItems: {
            ...state.activeItems,
            [sessionId]: delta.status === "in_progress" ? delta.item_id : null,
          },
        }));
      } else {
        // Coalesce progress for missing tasks while the authoritative snapshot
        // is fetched. A plan without the missing task keeps its own statuses.
        const missing = missingDuringRead.get(sessionId);
        if (missing) {
          missing.add(delta.item_id);
          return;
        }
        const pending = new Set([delta.item_id]);
        missingDuringRead.set(sessionId, pending);
        void current.loadTaskList(sessionId).catch(() => {}).finally(() => {
          if (missingDuringRead.get(sessionId) !== pending) return;
          missingDuringRead.delete(sessionId);
          const retained = progressBySession.get(sessionId);
          for (const id of pending) retained?.delete(id);
          if (retained?.size === 0) progressBySession.delete(sessionId);
        });
      }
    },

    // Clear task list for a session
    clearTaskList: (sessionId) => {
      missingDuringRead.delete(sessionId);
      progressBySession.delete(sessionId);
      set((state) => {
        const { [sessionId]: _, ...remainingTaskLists } = state.taskLists;
        const { [sessionId]: __, ...remainingVersions } = state.taskListVersions;
        const { [sessionId]: ___, ...remainingActive } = state.activeItems;
        const { [sessionId]: ____, ...remainingEvaluations } = state.evaluationStates;
        return {
          taskLists: remainingTaskLists,
          taskListVersions: remainingVersions,
          activeItems: remainingActive,
          evaluationStates: remainingEvaluations,
        };
      });
    },

    // Get current version
    getTaskListVersion: (sessionId) => {
      return get().taskListVersions[sessionId] || 0;
    },

    // Set evaluation state (NEW)
    setEvaluationState: (sessionId, evalState) =>
      set((state) => ({
        evaluationStates: {
          ...state.evaluationStates,
          [sessionId]: evalState,
        },
      })),

    // Clear evaluation state (NEW)
    clearEvaluationState: (sessionId) =>
      set((state) => {
        const { [sessionId]: _, ...remainingEvaluations } = state.evaluationStates;
        return {
          evaluationStates: remainingEvaluations,
        };
      }),
  };
};
