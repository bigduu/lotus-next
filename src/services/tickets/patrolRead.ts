import { apiClient, isApiError } from "@services/api"
import type { SnapshotRef } from "./types"

export interface PatrolReadTarget {
  projectId: string
  workId: string
  assignmentId: string
  generation: number
  assignmentAuthorityEpoch: number
  snapshot: SnapshotRef
}

export const object = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined

export const nonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0

// Both views render four-digit ISO dates from server times.
export const timestamp = (value: unknown): value is number =>
  nonNegativeInteger(value) && value <= 253402300799999

export function matchesPatrolScope(value: unknown, target: PatrolReadTarget): boolean {
  const scope = object(value)
  return scope?.project_id === target.projectId && scope.work_id === target.workId
    && scope.assignment_id === target.assignmentId && scope.generation === target.generation
    && scope.authority_epoch === target.assignmentAuthorityEpoch
}

type ReadFailure = { status: "unknown" | "denied" | "unavailable" }

export async function readPatrol<T>(
  endpoint: "observation" | "status", target: PatrolReadTarget, signal: AbortSignal, decode: (value: unknown) => T,
): Promise<T | ReadFailure> {
  const { projectId, workId, assignmentId } = target
  try {
    const value = await apiClient.postOnce<unknown>(`tickets/patrol/${endpoint}`, {
      project_id: projectId, work_id: workId, assignment_id: assignmentId,
    }, { signal, cache: "no-store" })
    return decode(value)
  } catch (failure) {
    if (isApiError(failure)) {
      if (failure.status === 401 || failure.status === 403) return { status: "denied" }
      // A 404 can also come from a stale selector on a supported backend.
      if (failure.status === 404 || failure.status === 405 || failure.status === 501) return { status: "unavailable" }
    }
    return { status: "unknown" }
  }
}
