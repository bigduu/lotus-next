import { uiText } from "@shared/i18n/ui"
import { apiClient } from "@services/api"
import type { ActorTreeData, ActorTreeNode } from "./actorTreeView"

export const ACTOR_SNAPSHOT_MAX_NODES = 256
export const ACTOR_SNAPSHOT_MAX_BYTES = 256 * 1024
export const ACTOR_SNAPSHOT_V2_MEDIA_TYPE = "application/vnd.bamboo.actor-snapshot.v2+json"
export const ACTOR_SNAPSHOT_ACCEPT = `${ACTOR_SNAPSHOT_V2_MEDIA_TYPE}, application/json;q=0.9`

/** Read-only evidence for this exact native Child activation; never control authority. */
export interface PublicLocalTaskObservation {
  state: "running" | "stopped" | "stop_unconfirmed"
  reason: "execution_stop_unconfirmed" | "lease_expired_without_stop" | null
  observed_at: string | null
  lease_expires_at: string | null
}

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
  /** Present only in negotiated v2; null means there is no native-task observation. */
  local_task?: PublicLocalTaskObservation | null
  activation: { activation_id: string; attempt: number; status: "reserved" | "running" | "succeeded" | "failed" | "cancelled" } | null
}

export interface ActorSubtreeSnapshot {
  schema_version: 1 | 2
  /** v2 transport hint only, not snapshot identity or proof that a task stopped. */
  refresh_after_ms?: number | null
  root_actor_id: string
  subtree_actor_id: string
  /** Equality identity only; never an ordering or replay cursor. */
  snapshot_id: string
  /** Durable Root tree cursor; null on an older Root without revision authority. */
  stream_cursor: string | null
  nodes: PublicActorSnapshotNode[]
}

export interface ActorTreeCursor {
  scope: string
  revision: number
}

/** Preserve the producer's canonical scope digest and safe revision exactly. */
export function parseActorTreeCursor(value: unknown): ActorTreeCursor | null {
  if (typeof value !== "string") return null
  const parts = /^at1-([0-9a-f]{64})-([1-9][0-9]*)$/.exec(value)
  if (!parts) return null
  const revision = Number(parts[2])
  return Number.isSafeInteger(revision) && revision > 0 ? { scope: parts[1], revision } : null
}

/** One REST snapshot covers a tree directive only within the same durable scope. */
export function actorTreeCursorCovers(snapshot: string | null, required: string | null): boolean {
  const observed = parseActorTreeCursor(snapshot)
  const gap = parseActorTreeCursor(required)
  return observed !== null && gap !== null && observed.scope === gap.scope && observed.revision >= gap.revision
}

/** Compare producer-validated RFC3339 instants without discarding nanoseconds. */
const compareEvidenceTime = (left: string, right: string): number => {
  const milliseconds = Date.parse(left) - Date.parse(right)
  if (milliseconds !== 0) return milliseconds
  const fraction = (value: string) => /\.(\d{1,9})(?:Z|[+-])/.exec(value)?.[1].padEnd(9, "0") ?? "000000000"
  return fraction(left).localeCompare(fraction(right))
}

/** These are observation fences only; no diagnostic authorizes control or replacement. */
const localTaskRegresses = (prior: PublicLocalTaskObservation | null | undefined,
  next: PublicLocalTaskObservation | null | undefined): boolean => {
  if (!prior) return false
  if (prior.state === "stopped" && next?.state !== "stopped") return true
  if (prior.state === "stop_unconfirmed") {
    if (!next) return true
    if (prior.reason === "execution_stop_unconfirmed" && next.state !== "stopped" &&
      (next.state !== "stop_unconfirmed" || next.reason !== prior.reason)) return true
    if (prior.reason === "lease_expired_without_stop" && next.state === "running" &&
      (!prior.lease_expires_at || !next.lease_expires_at || compareEvidenceTime(next.lease_expires_at, prior.lease_expires_at) <= 0)) return true
  }
  if (!next || next.state !== prior.state || next.reason !== prior.reason) return false
  return prior.observed_at !== null && next.observed_at !== null && compareEvidenceTime(next.observed_at, prior.observed_at) < 0
    || prior.lease_expires_at !== null && next.lease_expires_at !== null && compareEvidenceTime(next.lease_expires_at, prior.lease_expires_at) < 0
}

/**
 * A durable Root cursor orders complete tree snapshots, including removal and
 * private revisions that leave snapshot_id unchanged. Per-Actor revisions
 * still reject an individually regressed row when both views contain it.
 */
export function actorSnapshotRegresses(previous: ActorSubtreeSnapshot, next: ActorSubtreeSnapshot): boolean {
  if (previous.root_actor_id !== next.root_actor_id || previous.subtree_actor_id !== next.subtree_actor_id) return false
  if (previous.stream_cursor !== null && !actorTreeCursorCovers(next.stream_cursor, previous.stream_cursor)) return true
  const known = new Map(previous.nodes.map((node) => [node.actor_id, node]))
  for (const node of next.nodes) {
    const prior = known.get(node.actor_id)
    if (!prior) continue
    if (node.revision.session_metadata_version < prior.revision.session_metadata_version) return true
    const priorDirectory = prior.revision.actor_directory_revision
    const nextDirectory = node.revision.actor_directory_revision
    if (priorDirectory !== null && nextDirectory !== null && nextDirectory < priorDirectory) return true
    if (prior.activation && node.activation && node.activation.attempt < prior.activation.attempt) return true
    if (prior.activation && node.activation && prior.activation.activation_id === node.activation.activation_id &&
      prior.activation.attempt === node.activation.attempt && localTaskRegresses(prior.local_task, node.local_task)) return true
    if (priorDirectory !== null && nextDirectory === priorDirectory && prior.activation && node.activation &&
      node.activation.attempt === prior.activation.attempt && node.activation.activation_id !== prior.activation.activation_id) return true
  }
  return false
}

export class InvalidActorSnapshotError extends Error {
  constructor() { super(uiText("the_agent_structure_response_is_invalid_or_unsupported__d3bdb4ac")) }
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
const timestamp = (value: unknown): value is string => {
  if (typeof value !== "string") return false
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value)
  if (!parts || parts[0] !== value || !Number.isFinite(Date.parse(value))) return false
  const [year, month, day, hour, minute, second] = parts.slice(1, 7).map(Number)
  const zoneHour = Number(parts[7] ?? 0), zoneMinute = Number(parts[8] ?? 0)
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
    && hour < 24 && minute < 60 && second < 60 && zoneHour < 24 && zoneMinute < 60
}
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
  const version = value && typeof value === "object" && "schema_version" in value ? value.schema_version : null
  const response = object(value, ["schema_version", "root_actor_id", "subtree_actor_id", "snapshot_id", "stream_cursor", "nodes",
    ...(version === 2 ? ["refresh_after_ms"] : [])])
  if ((version !== 1 && version !== 2) || response.root_actor_id !== rootId || response.subtree_actor_id !== subtreeId
    || typeof response.snapshot_id !== "string" || response.snapshot_id.length !== 68 || !new RegExp(`^as${version}-[0-9a-f]{64}$`).test(response.snapshot_id)
    || (response.stream_cursor !== null && !parseActorTreeCursor(response.stream_cursor)) || !Array.isArray(response.nodes)
    || response.nodes.length === 0 || response.nodes.length > ACTOR_SNAPSHOT_MAX_NODES
    || version === 2 && response.refresh_after_ms !== null && (!safeInteger(response.refresh_after_ms)
      || response.refresh_after_ms < 1_000 || response.refresh_after_ms > 2_147_483_647)) return invalid()

  const nodes: PublicActorSnapshotNode[] = []
  const byId = new Map<string, PublicActorSnapshotNode>()
  for (const source of response.nodes) {
    const row = object(source, ["actor_id", "parent_actor_id", "root_actor_id", "depth", "title", "role", "logical_state", "placement_class", "revision", "activation",
      ...(version === 2 ? ["local_task"] : [])])
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
    let localTask: PublicLocalTaskObservation | null = null
    if (version === 2 && row.local_task !== null) {
      const task = object(row.local_task, ["state", "reason", "observed_at", "lease_expires_at"])
      if (row.role !== "child" || row.placement_class !== null && row.placement_class !== "local" || activation === null
        || !oneOf(task.state, ["running", "stopped", "stop_unconfirmed"])
        || (task.state === "stop_unconfirmed"
          ? !oneOf(task.reason, ["execution_stop_unconfirmed", "lease_expired_without_stop"])
          : task.reason !== null)
        || task.observed_at !== null && !timestamp(task.observed_at)
        || task.lease_expires_at !== null && !timestamp(task.lease_expires_at)) return invalid()
      localTask = { state: task.state, reason: task.reason as PublicLocalTaskObservation["reason"],
        observed_at: task.observed_at as string | null, lease_expires_at: task.lease_expires_at as string | null }
    }
    const node: PublicActorSnapshotNode = {
      actor_id: row.actor_id, parent_actor_id: row.parent_actor_id as string | null, root_actor_id: rootId,
      depth: row.depth, title: row.title, role: row.role,
      ...(version === 2 ? { local_task: localTask } : {}),
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
  return { schema_version: version, ...(version === 2 ? { refresh_after_ms: response.refresh_after_ms as number | null } : {}), root_actor_id: rootId, subtree_actor_id: subtreeId,
    snapshot_id: response.snapshot_id, stream_cursor: response.stream_cursor as string | null, nodes }
}

/** A bounded body read through the existing authenticated cancellation kernel. */
export async function getActorSnapshot(rootId: string, subtreeId = rootId, signal?: AbortSignal): Promise<ActorSubtreeSnapshot> {
  if (!actorId(rootId) || !actorId(subtreeId)) return invalid()
  const query = new URLSearchParams({ subtree_id: subtreeId })
  const response = await apiClient.fetchRaw(`actors/${encodeURIComponent(rootId)}/snapshot?${query}`, { signal, cache: "no-store", headers: { Accept: ACTOR_SNAPSHOT_ACCEPT } })
  const reader = response.body?.getReader()
  if (!reader) return invalid()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    const mediaType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase()
    if (mediaType !== "application/json" && mediaType !== ACTOR_SNAPSHOT_V2_MEDIA_TYPE) return invalid()
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

const sameTreeNode = (left: ActorTreeNode, right: ActorTreeNode): boolean =>
  left.actorId === right.actorId && left.parentActorId === right.parentActorId &&
  left.depth === right.depth && left.title === right.title && left.role === right.role &&
  left.lifecycle === right.lifecycle && left.placement === right.placement &&
  left.health === right.health && left.localTaskDiagnostic === right.localTaskDiagnostic && left.queuedCount === right.queuedCount &&
  left.waitingForCount === right.waitingForCount && left.pendingRequestCount === right.pendingRequestCount

/** Show the last durable activation outcome when the logical actor is idle. */
const snapshotLifecycle = (node: PublicActorSnapshotNode): ActorTreeNode["lifecycle"] => {
  if (node.logical_state === "retired" || node.logical_state === "failed" || node.logical_state === null) {
    return node.logical_state ?? "unknown"
  }
  if (node.logical_state === "active") {
    if (node.local_task && node.local_task.state !== "running") return "unknown"
    if (node.activation?.status === "reserved") return "queued"
    if (node.activation?.status === "running") return "running"
  }
  if (node.logical_state === "cold") {
    if (node.activation?.status === "succeeded") return "completed"
    if (node.activation?.status === "cancelled") return "cancelled"
  }
  return node.logical_state
}

/** Snapshot-only rendering never fabricates per-Actor event cursors. */
export function actorSnapshotTree(
  snapshot: ActorSubtreeSnapshot,
  loading = false,
  previous?: ActorTreeData,
): ActorTreeData {
  const prior = previous?.rootActorId === snapshot.subtree_actor_id ? previous : undefined
  const byId: Record<string, ActorTreeNode> = Object.create(null)
  const childrenById: Record<string, readonly string[]> = Object.create(null)
  const children: Record<string, string[]> = Object.create(null)
  for (const node of snapshot.nodes) {
    const projected: ActorTreeNode = {
      actorId: node.actor_id, parentActorId: node.parent_actor_id, depth: node.depth,
      title: node.title, role: node.role === "root" ? uiText("root_agent_9cfcb9f9") : uiText("sub_agent_acd37b4c"),
      lifecycle: snapshotLifecycle(node), placement: node.placement_class ?? "unknown",
      health: node.local_task && node.local_task.state !== "running" ? "unknown" : null,
      localTaskDiagnostic: node.local_task && node.local_task.state !== "running" ? node.local_task.state : null,
      queuedCount: null, waitingForCount: null, pendingRequestCount: null,
    }
    const old = prior?.byId[node.actor_id]
    byId[node.actor_id] = old && sameTreeNode(old, projected) ? old : projected
    children[node.actor_id] = []
  }
  for (const node of snapshot.nodes) {
    if (node.actor_id !== snapshot.subtree_actor_id && node.parent_actor_id !== null) children[node.parent_actor_id].push(node.actor_id)
  }
  for (const [actorId, ids] of Object.entries(children)) {
    const old = prior?.childrenById[actorId]
    childrenById[actorId] = old && old.length === ids.length && old.every((id, index) => id === ids[index]) ? old : ids
  }
  if (prior && prior.needsSnapshot === loading && Object.keys(prior.byId).length === snapshot.nodes.length &&
    snapshot.nodes.every((node) => prior.byId[node.actor_id] === byId[node.actor_id] &&
      prior.childrenById[node.actor_id] === childrenById[node.actor_id])) return prior
  return { rootActorId: snapshot.subtree_actor_id, byId, childrenById, needsSnapshot: loading }
}
