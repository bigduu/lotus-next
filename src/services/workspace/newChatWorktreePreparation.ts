import { projectService } from "@services/project/ProjectService"
import { useAppStore } from "@shared/store/appStore"
import type { ProjectManifest, WorkspaceBindingRequest } from "@services/project/types"
import { worktreeService } from "./WorktreeService"
import { createWorktreeSelection, type NewChatWorktreeSelection } from "./newChatWorktreeTypes"

export type WorktreePreparationFailure = "invalid" | "failed" | "uncertain" | "context-changed"
  | "missing-root" | "no-source" | "source-unavailable" | "ambiguous-source"

export class NewChatWorktreePreparationError extends Error {
  constructor(readonly kind: WorktreePreparationFailure, options?: ErrorOptions) {
    super(kind, options)
    this.name = "NewChatWorktreePreparationError"
  }
}

type Dependencies = {
  getProject: (id: string) => Promise<ProjectManifest>
  list: typeof worktreeService.list
  create: typeof worktreeService.create
  bindWorkspace: (id: string, revision: number, request: WorkspaceBindingRequest) => Promise<ProjectManifest>
}

function isBound(project: ProjectManifest, path: string) {
  return project.project_path === path || (project.workspace_bindings ?? []).some((binding) => binding.path === path)
}

function isValidSelection(selection: Readonly<NewChatWorktreeSelection>) {
  return [selection.repository, selection.root, selection.name, selection.branch]
    .every((value) => typeof value === "string" && !!value.trim())
    && /^[A-Za-z0-9_-]{1,80}$/.test(selection.name)
    && /^(?:\/|[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/.test(selection.root)
    && !["\0", "\r", "\n"].some((character) => selection.root.includes(character))
    && selection.branch !== "HEAD" && !selection.branch.startsWith("-")
}

/** One draft's side effect ledger. Never infer ownership from a matching name/path. */
export class NewChatWorktreePreparation {
  selection: Readonly<NewChatWorktreeSelection> | null = null
  useProjectDefault = true
  path: string | null = null
  private projectOwnedAtRevision: number | null = null
  busy = false
  uncertain = false
  error: NewChatWorktreePreparationError | null = null

  constructor(
    readonly projectId: string | null,
    private readonly changed: () => void,
    private readonly dependencies: Dependencies = {
      getProject: (id) => projectService.getProject(id),
      list: (id, options) => worktreeService.list(id, options),
      create: (id, request) => worktreeService.create(id, request),
      // Publish the authoritative ACK through the existing revision-aware store
      // action, even if navigation prevents the pending message from sending.
      bindWorkspace: (id, revision, request) => useAppStore.getState().bindWorkspace(id, revision, request),
    },
  ) {}

  get locked() { return this.busy || this.path !== null || this.uncertain }

  select(value: NewChatWorktreeSelection | null) {
    if (this.locked) return
    this.useProjectDefault = false
    this.selection = value ? Object.freeze({ ...value }) : null
    this.error = null
    this.changed()
  }

  private async projectSelection(project: ProjectManifest, assertCurrent: () => void) {
    if (project.new_chat_worktree !== true) throw new NewChatWorktreePreparationError("context-changed")
    const inventory = await this.dependencies.list(project.id, { sourcesOnly: true })
    assertCurrent()
    if (inventory.project_id !== project.id) throw new NewChatWorktreePreparationError("invalid")
    if (!inventory.default_root?.trim()) throw new NewChatWorktreePreparationError("missing-root")
    const configured = inventory.repositories.find((repo) => repo.path === project.project_path)
    if (configured?.error) throw new NewChatWorktreePreparationError("source-unavailable")
    const repositories = inventory.repositories.filter((repo) => !repo.error)
    const source = configured
      ?? (repositories.length === 1 ? repositories[0] : undefined)
    if (!source) throw new NewChatWorktreePreparationError(repositories.length ? "ambiguous-source" : "no-source")
    return createWorktreeSelection(source.path, inventory.default_root)
  }

  async prepare(isCurrent: () => boolean, automatic = false): Promise<string> {
    if (this.busy) throw new NewChatWorktreePreparationError("failed")
    if (this.uncertain) throw this.error ?? new NewChatWorktreePreparationError("uncertain")
    if (!this.projectId?.trim() || (this.selection ? !isValidSelection(this.selection) : !automatic)) {
      this.error = new NewChatWorktreePreparationError("invalid")
      this.changed()
      throw this.error
    }
    const assertCurrent = () => {
      if (!isCurrent()) throw new NewChatWorktreePreparationError("context-changed")
    }
    this.busy = true
    this.error = null
    this.changed()
    try {
      assertCurrent()
      // This read validates the selected Project and refreshes CAS on every retry.
      let project = await this.dependencies.getProject(this.projectId)
      assertCurrent()
      if (project.id !== this.projectId || project.status !== "active") {
        throw new NewChatWorktreePreparationError("invalid")
      }
      if (!this.path) {
        const selection = this.selection ?? await this.projectSelection(project, assertCurrent)
        assertCurrent()
        if (!isValidSelection(selection)) throw new NewChatWorktreePreparationError("invalid")
        this.selection = Object.freeze(selection)
        try {
          // postOnce: a transport failure is NOT proof that git worktree add failed.
          const created = await this.dependencies.create(this.projectId, { ...selection })
          if (typeof created?.path !== "string" || !created.path.trim()) {
            throw new NewChatWorktreePreparationError("uncertain")
          }
          // Record the ACK before any binding, navigation check, or further await.
          this.path = created.path
          this.projectOwnedAtRevision = created.project_owned_at_revision ?? null
          this.changed()
        } catch (cause) {
          // Even HTTP 400 can follow a partially successful git worktree add.
          // No current response proves that filesystem mutation did not occur.
          this.uncertain = true
          throw new NewChatWorktreePreparationError("uncertain", { cause })
        }
        assertCurrent()
        project = await this.dependencies.getProject(this.projectId)
        assertCurrent()
      }
      if (project.id !== this.projectId || project.status !== "active") {
        throw new NewChatWorktreePreparationError("invalid")
      }
      let owned = isBound(project, this.path) || this.projectOwnedAtRevision === project.revision
      if (!owned && this.projectOwnedAtRevision !== null) {
        const inventory = await this.dependencies.list(this.projectId)
        assertCurrent()
        owned = inventory.project_id === project.id && inventory.repositories.some((repo) =>
          repo.worktrees.some((worktree) => worktree.path === this.path && worktree.project_owned === true
            && worktree.openable === true))
      }
      if (!owned) {
        project = await this.dependencies.bindWorkspace(this.projectId, project.revision, { path: this.path })
        if (project.id !== this.projectId || !isBound(project, this.path)) {
          throw new NewChatWorktreePreparationError("failed")
        }
      }
      assertCurrent()
      return this.path
    } catch (cause) {
      this.error = cause instanceof NewChatWorktreePreparationError
        ? cause : new NewChatWorktreePreparationError("failed", { cause })
      throw this.error
    } finally {
      this.busy = false
      this.changed()
    }
  }
}
