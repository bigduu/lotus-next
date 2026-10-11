/** Bamboo #1337 schema-v1 public DTO, including deliberately unknown observations. */
export function actorSnapshotFixture(rootId = "root", count = 128, streamCursor: string | null = null) {
  const node = (id: string, parent: string | null, depth: number) => ({
    actor_id: id, parent_actor_id: parent, root_actor_id: rootId, depth, title: id,
    role: parent === null ? "root" as const : "child" as const, logical_state: null as "cold" | "active" | "failed" | "retired" | null, placement_class: null as "local" | "docker" | "ssh" | "remote" | "schedulable" | null,
    revision: { session_metadata_version: 1, actor_directory_revision: null as number | null },
    activation: null as { activation_id: string; attempt: number; status: "reserved" | "running" | "succeeded" | "failed" | "cancelled" } | null,
  })
  const nodes = [node(rootId, null, 0)]
  for (let index = 0; index < count; index += 1) {
    const parent = index < 8 ? rootId : index < 64 ? "actor-0" : "actor-8"
    nodes.push(node(`actor-${index}`, parent, index < 8 ? 1 : index < 64 ? 2 : 3))
  }
  if (nodes[1]) Object.assign(nodes[1], { logical_state: "active", placement_class: "remote",
    revision: { session_metadata_version: 7, actor_directory_revision: 2 },
    activation: { activation_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", attempt: 1, status: "running" } })
  return { schema_version: 1 as const, root_actor_id: rootId, subtree_actor_id: rootId,
    snapshot_id: `as1-${"a".repeat(64)}`, stream_cursor: streamCursor, nodes }
}

/** Explicitly negotiated native-task diagnostic; does not grant stop authority. */
export function actorSnapshotV2Fixture(
  taskState: "running" | "stopped" | "stop_unconfirmed" = "running",
  rootId = "root",
  refreshAfter: number | null = taskState === "running" ? 1_000 : null,
) {
  const source = actorSnapshotFixture(rootId, 1)
  return { ...source, schema_version: 2 as const, snapshot_id: `as2-${"a".repeat(64)}`, refresh_after_ms: refreshAfter,
    nodes: source.nodes.map((node) => ({ ...node,
      // Native local tasks have a Local intent but no concrete placement_ref.
      placement_class: null as "local" | "remote" | null,
      local_task: node.role === "child" ? {
        state: taskState, reason: (taskState === "stop_unconfirmed" ? "execution_stop_unconfirmed" : null) as "execution_stop_unconfirmed" | "lease_expired_without_stop" | null,
        observed_at: "2026-10-11T09:00:00Z", lease_expires_at: "2026-10-11T09:00:01Z",
      } : null,
    })),
  }
}
