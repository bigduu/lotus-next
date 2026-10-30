import { apiClient } from "../api"

/**
 * Per-checkout merge state, derived by the backend from **local Git refs only**.
 *
 * The backend never fetches and never contacts a forge, so this is exactly as
 * fresh as the last `git fetch`. Crucially, local refs cannot observe a squash
 * merge, so a squash-landed branch is reported `in_progress` until an
 * authoritative provider answers. The UI must therefore never present
 * `in_progress` as "definitely unmerged" and never invent a `merged` state.
 */
export type WorktreeMergeState = "primary" | "merged" | "in_progress" | "unknown"

export interface WorktreeMergeEntry {
  path: string
  state: WorktreeMergeState
  /** Stable machine reason; diagnostic provenance, not UI copy. */
  reason: string
  branch: string | null
  head: string
}

export interface WorktreeMergeRepository {
  path: string
  /** Present when the integration branch could be resolved, e.g. `origin/dev`. */
  base_ref?: string
  base_commit?: string
  /** Present when the whole repository could not be answered, e.g. `no_base_ref`. */
  error?: string
  worktrees: WorktreeMergeEntry[]
}

export interface ProjectWorktreeMergeState {
  project_id: string
  repositories: WorktreeMergeRepository[]
}

export const worktreeMergeService = {
  /** One request per Project; callers must share the result across rows. */
  state: (projectId: string) =>
    apiClient.get<ProjectWorktreeMergeState>(
      `projects/${encodeURIComponent(projectId)}/worktrees/merge-state`,
    ),
}
