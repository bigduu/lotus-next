import type { ActorTreeNode } from "@services/chat/actorTreeView"

import type { createUiText } from "../../shell/uiText"

type Text = ReturnType<typeof createUiText>
type Key = Parameters<Text>[0]

const lifeKeys: Record<ActorTreeNode["lifecycle"], Key> = {
  active: "activity_f98dfe0b",
  unknown: "lifecycle_unknown_2217e6e4",
  unconfirmed: "unconfirmed_c098e854",
  cold: "not_started_e6fc5eb8",
  queued: "queued_d6f766f2",
  running: "running_1f0eb99b",
  suspended: "paused_eb0c326b",
  completed: "completed_f28461bb",
  failed: "failed_28384d7a",
  cancelled: "cancelled_a37778f1",
  retired: "exited_899df7e2",
  lost: "unreachable_8deefc6c",
}

export function actorLifecycleLabel(node: ActorTreeNode, text: Text) {
  if (node.lifecycle === "unknown" && node.localTaskDiagnostic) {
    return text(node.localTaskDiagnostic === "stop_unconfirmed"
      ? "native_task_stop_unconfirmed" : "native_task_stopped_outcome_unconfirmed")
  }
  return text(lifeKeys[node.lifecycle])
}

export const actorTitle = (node: ActorTreeNode, text: Text) => node.title || text("unnamed_agent_1ff6bc72")
