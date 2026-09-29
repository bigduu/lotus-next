/** Bamboo #1337 schema-v1 public DTO, including deliberately unknown observations. */
export function actorSnapshotFixture(rootId = "root", count = 128, streamCursor: string | null = null) {
  const node = (id: string, parent: string | null, depth: number) => ({
    actor_id: id, parent_actor_id: parent, root_actor_id: rootId, depth, title: id,
    role: parent === null ? "root" as const : "child" as const, logical_state: null, placement_class: null,
    revision: { session_metadata_version: 1, actor_directory_revision: null },
    activation: null as { activation_id: string; attempt: number; status: "running" } | null,
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
