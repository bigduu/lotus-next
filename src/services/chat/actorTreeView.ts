import type { ActorLifecycle, ActorHealth, ActorPlacement } from "./actorTopology"

/** Public visual fields; snapshot views need no event sequence or global revision. */
export interface ActorTreeNode {
  actorId: string
  parentActorId: string | null
  depth: number
  title: string
  role: string | null
  lifecycle: ActorLifecycle | "active" | "unknown"
  placement: ActorPlacement | "docker" | "ssh" | "schedulable"
  health: ActorHealth | null
  /** Native execution evidence does not replace the canonical business outcome. */
  localTaskDiagnostic?: "stopped" | "stop_unconfirmed" | null
  queuedCount: number | null
  waitingForCount: number | null
  pendingRequestCount: number | null
}

export interface ActorTreeData {
  rootActorId: string
  byId: Readonly<Record<string, ActorTreeNode>>
  childrenById: Readonly<Record<string, readonly string[]>>
  needsSnapshot: boolean
}
