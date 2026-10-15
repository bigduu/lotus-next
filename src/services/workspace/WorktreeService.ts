import { apiClient } from "../api"

export interface WorktreePreferences {
  default_root?: string | null
  project_roots?: Record<string, string>
}
export interface GitWorktree {
  path: string
  branch: string | null
  head: string
  locked: boolean
  prunable: boolean
  dirty: boolean | null
  error: string | null
  occupied: boolean
  sessions: { id: string; title: string; active: boolean }[]
}
export interface WorktreeRepository {
  path: string
  common_dir?: string
  error: string | null
  worktrees: GitWorktree[]
}
export interface ProjectWorktrees {
  project_id: string
  default_root: string | null
  repositories: WorktreeRepository[]
}
export const worktreeService = {
  preferences: () => apiClient.get<WorktreePreferences>("worktrees/preferences"),
  saveRoot: (root: string | null, projectId?: string) =>
    apiClient.put<WorktreePreferences>("worktrees/preferences", { root, ...(projectId ? { project_id: projectId } : {}) }),
  list: (projectId: string) => apiClient.get<ProjectWorktrees>(`projects/${encodeURIComponent(projectId)}/worktrees`),
  create: (projectId: string, request: { repository: string; root: string; name: string; branch: string }) =>
    apiClient.post<{ path: string }>(`projects/${encodeURIComponent(projectId)}/worktrees`, request),
}
