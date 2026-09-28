import { apiClient } from "@services/api"
import type { ActorTreeData, ActorTreeNode } from "./actorTreeView"

export const ACTOR_SNAPSHOT_MAX_NODES = 256
export const ACTOR_SNAPSHOT_MAX_BYTES = 256 * 1024

export interface PublicActorSnapshotNode {
  actor_id: string
  parent_actor_id: string | null
  root_actor_id: string
  depth: number
  title: string
  role: "root" | "child"
  logical_state: "cold" | "active" | "failed" | "retired" | null
  placement_class: "local" | "docker" | "ssh" | "remote" | "schedulable" | null
  revision: { session_metadata_version: number; actor_directory_revision: number | null }
  activation: { activation_id: string; attempt: number; status: "reserved" | "running" | "succeeded" | "failed" | "cancelled" } | null
}

export interface ActorSubtreeSnapshot {
  schema_version: 1
  root_actor_id: string
  subtree_actor_id: string
  /** Equality identity only; never an ordering or replay cursor. */
  snapshot_id: string
  stream_cursor: null
  nodes: PublicActorSnapshotNode[]
}

export class InvalidActorSnapshotError extends Error {
  constructor() { super("代理结构响应无效或不受支持，请重新读取。") }
}

const invalid = (): never => { throw new InvalidActorSnapshotError() }
const encoder = new TextEncoder()
// Match producer Uuid::parse_str forms; preserve the original wire identity.
const activationId = (value: unknown): value is string => {
  if (typeof value !== "string") return false
  if (value.length === 32) return /^[0-9a-f]{32}$/i.test(value)
  const uuid = value.length === 38 && value.startsWith("{") && value.endsWith("}") ? value.slice(1, -1)
    : value.length === 45 && value.startsWith("urn:uuid:") ? value.slice(9) : value
  return uuid.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)
}
const safeInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
const publicText = (value: unknown, max: number): value is string => typeof value === "string"
  && [...value].length <= max && ![...value].some((character) => {
    const code = character.codePointAt(0)!
    return code < 32 || code >= 127 && code <= 159 || code >= 0xd800 && code <= 0xdfff
      || code >= 0x202a && code <= 0x202e || code >= 0x2066 && code <= 0x2069
  })
const actorId = (value: unknown): value is string => publicText(value, 256) && value.length > 0
  && value.trim() === value && encoder.encode(value).length <= 256 && !value.includes("..") && !/[\\/]/.test(value)
const oneOf = <T extends string>(value: unknown, values: readonly T[]): value is T => values.includes(value as T)
const object = (value: unknown, keys: readonly string[]): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid()
  const record = value as Record<string, unknown>
  const actual = Object.keys(record)
  if (actual.length !== keys.length || keys.some((key) => !Object.hasOwn(record, key))) return invalid()
  return record
}

/** Reject the whole response; a partial or guessed tree cannot prove scope. */
export function parseActorSnapshot(value: unknown, rootId: string, subtreeId = rootId): ActorSubtreeSnapshot {
  if (!actorId(rootId) || !actorId(subtreeId)) return invalid()
  const response = object(value, ["schema_version", "root_actor_id", "subtree_actor_id", "snapshot_id", "stream_cursor", "nodes"])
  if (response.schema_version !== 1 || response.root_actor_id !== rootId || response.subtree_actor_id !== subtreeId
    || typeof response.snapshot_id !== "string" || response.snapshot_id.length !== 68 || !/^as1-[0-9a-f]{64}$/.test(response.snapshot_id)
    || response.stream_cursor !== null || !Array.isArray(response.nodes)
    || response.nodes.length === 0 || response.nodes.length > ACTOR_SNAPSHOT_MAX_NODES) return invalid()

  const nodes: PublicActorSnapshotNode[] = []
  const byId = new Map<string, PublicActorSnapshotNode>()
  for (const source of response.nodes) {
    const row = object(source, ["actor_id", "parent_actor_id", "root_actor_id", "depth", "title", "role", "logical_state", "placement_class", "revision", "activation"])
    if (!actorId(row.actor_id) || byId.has(row.actor_id) || row.root_actor_id !== rootId
      || (row.parent_actor_id !== null && !actorId(row.parent_actor_id))
      || !safeInteger(row.depth) || row.depth > 0xffff_ffff || !publicText(row.title, 160)
      || !oneOf(row.role, ["root", "child"])
      || (row.logical_state !== null && !oneOf(row.logical_state, ["cold", "active", "failed", "retired"]))
      || (row.placement_class !== null && !oneOf(row.placement_class, ["local", "docker", "ssh", "remote", "schedulable"]))) return invalid()
    const revision = object(row.revision, ["session_metadata_version", "actor_directory_revision"])
    if (!safeInteger(revision.session_metadata_version)
      || (revision.actor_directory_revision !== null && (!safeInteger(revision.actor_directory_revision) || revision.actor_directory_revision === 0))) return invalid()
    let activation: PublicActorSnapshotNode["activation"] = null
    if (row.activation !== null) {
      const sourceActivation = object(row.activation, ["activation_id", "attempt", "status"])
      if (!activationId(sourceActivation.activation_id)
        || !safeInteger(sourceActivation.attempt) || sourceActivation.attempt === 0
        || !oneOf(sourceActivation.status, ["reserved", "running", "succeeded", "failed", "cancelled"])) return invalid()
      activation = { activation_id: sourceActivation.activation_id, attempt: sourceActivation.attempt, status: sourceActivation.status }
    }
    if (revision.actor_directory_revision === null && (row.logical_state !== null || activation !== null || row.placement_class !== null)
      || row.logical_state === null && revision.actor_directory_revision !== null
      || activation === null && row.placement_class !== null) return invalid()
    const node: PublicActorSnapshotNode = {
      actor_id: row.actor_id, parent_actor_id: row.parent_actor_id as string | null, root_actor_id: rootId,
      depth: row.depth, title: row.title, role: row.role,
      logical_state: row.logical_state as PublicActorSnapshotNode["logical_state"],
      placement_class: row.placement_class as PublicActorSnapshotNode["placement_class"],
      revision: { session_metadata_version: revision.session_metadata_version, actor_directory_revision: revision.actor_directory_revision as number | null }, activation,
    }
    nodes.push(node); byId.set(node.actor_id, node)
  }
  const subtree = byId.get(subtreeId)
  if (!subtree) return invalid()
  if (subtreeId === rootId ? subtree.parent_actor_id !== null || subtree.depth !== 0 || subtree.role !== "root"
    : subtree.parent_actor_id === null || byId.has(subtree.parent_actor_id) || subtree.depth === 0 || subtree.role !== "child") return invalid()
  const children = new Map<string, string[]>()
  for (const node of nodes) {
    if (node.actor_id === subtreeId) continue
    const parent = node.parent_actor_id === null ? undefined : byId.get(node.parent_actor_id)
    if (!parent || node.role !== "child" || node.depth !== parent.depth + 1) return invalid()
    const siblings = children.get(parent.actor_id) ?? []
    siblings.push(node.actor_id); children.set(parent.actor_id, siblings)
  }
  const seen = new Set<string>()
  const pending = [subtreeId]
  for (let index = 0; index < pending.length; index += 1) {
    if (seen.has(pending[index])) return invalid()
    seen.add(pending[index]); pending.push(...(children.get(pending[index]) ?? []))
  }
  if (seen.size !== nodes.length) return invalid()
  return { schema_version: 1, root_actor_id: rootId, subtree_actor_id: subtreeId,
    snapshot_id: response.snapshot_id, stream_cursor: null, nodes }
}

/** A bounded body read through the existing authenticated cancellation kernel. */
export async function getActorSnapshot(rootId: string, subtreeId = rootId, signal?: AbortSignal): Promise<ActorSubtreeSnapshot> {
  if (!actorId(rootId) || !actorId(subtreeId)) return invalid()
  const query = new URLSearchParams({ subtree_id: subtreeId })
  const response = await apiClient.fetchRaw(`actors/${encodeURIComponent(rootId)}/snapshot?${query}`, { signal, cache: "no-store" })
  const reader = response.body?.getReader()
  if (!reader) return invalid()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    if (!response.headers.get("content-type")?.includes("application/json")) return invalid()
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > ACTOR_SNAPSHOT_MAX_BYTES) return invalid()
      chunks.push(chunk.value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  let value: unknown
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) } catch { return invalid() }
  return parseActorSnapshot(value, rootId, subtreeId)
}

/** Snapshot-only rendering never fabricates directory revisions or event cursors. */
export function actorSnapshotTree(snapshot: ActorSubtreeSnapshot, loading = false): ActorTreeData {
  const byId: Record<string, ActorTreeNode> = Object.create(null)
  const childrenById: Record<string, string[]> = Object.create(null)
  for (const node of snapshot.nodes) {
    byId[node.actor_id] = {
      actorId: node.actor_id, parentActorId: node.parent_actor_id, depth: node.depth,
      title: node.title, role: node.role === "root" ? "根代理" : "子代理",
      lifecycle: node.logical_state ?? "unknown", placement: node.placement_class ?? "unknown",
      health: null, queuedCount: null, waitingForCount: null, pendingRequestCount: null,
    }
    childrenById[node.actor_id] = []
  }
  for (const node of snapshot.nodes) {
    if (node.actor_id !== snapshot.subtree_actor_id && node.parent_actor_id !== null) childrenById[node.parent_actor_id].push(node.actor_id)
  }
  return { rootActorId: snapshot.subtree_actor_id, byId, childrenById, needsSnapshot: loading }
}
