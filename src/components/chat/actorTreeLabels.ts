import { uiText } from "@shared/i18n/ui"
import type { ActorTreeNode } from "@/services/chat/actorTreeView"

const LIFECYCLE_LABEL: Record<ActorTreeNode["lifecycle"], string> = {
  get active() { return uiText("activity_f98dfe0b") },
  get unknown() { return uiText("lifecycle_unknown_2217e6e4") },
  get unconfirmed() { return uiText("unconfirmed_c098e854") },
  get cold() { return uiText("not_started_e6fc5eb8") },
  get queued() { return uiText("queued_d6f766f2") },
  get running() { return uiText("running_1f0eb99b") },
  get suspended() { return uiText("paused_eb0c326b") },
  get completed() { return uiText("completed_f28461bb") },
  get failed() { return uiText("failed_28384d7a") },
  get cancelled() { return uiText("cancelled_a37778f1") },
  get retired() { return uiText("exited_899df7e2") },
  get lost() { return uiText("unreachable_8deefc6c") },
}

export function actorLifecycleLabel(node: ActorTreeNode) {
  if (node.lifecycle === "unknown" && node.localTaskDiagnostic) {
    return uiText(node.localTaskDiagnostic === "stop_unconfirmed"
      ? "native_task_stop_unconfirmed" : "native_task_stopped_outcome_unconfirmed")
  }
  return LIFECYCLE_LABEL[node.lifecycle]
}
