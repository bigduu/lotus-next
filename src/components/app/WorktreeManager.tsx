import { useEffect, useRef, useState } from "react"
import { GitBranch, RefreshCw } from "lucide-react"
import { useUiText } from "@shared/i18n/ui"
import { useAppStore } from "@shared/store/appStore"
import { projectService } from "@services/project"
import { worktreeService, type ProjectWorktrees, type WorktreePreferences } from "@services/workspace/WorktreeService"
import { getErrorMessage } from "@services/api/errors"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogTitle } from "@/components/ui/responsive-dialog"

export function WorktreeManager({ open, onClose, onOpen, onSession }: {
  open: boolean
  onClose: () => void
  onOpen: (projectId: string, path: string) => void
  onSession: (id: string) => void
}) {
  const uiText = useUiText()
  const projects = useAppStore((state) => state.projects)
  const [projectId, setProjectId] = useState("")
  const [preferences, setPreferences] = useState<WorktreePreferences | null>(null)
  const [listing, setListing] = useState<ProjectWorktrees | null>(null)
  const [globalRoot, setGlobalRoot] = useState("")
  const [projectRoot, setProjectRoot] = useState("")
  const [repository, setRepository] = useState("")
  const [root, setRoot] = useState("")
  const [name, setName] = useState("")
  const [branch, setBranch] = useState("")
  const [busy, setBusy] = useState(false)
  const actionInFlight = useRef(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdPath, setCreatedPath] = useState<string | null>(null)
  const activeProjects = Object.values(projects).filter((project) => project.status === "active")
  const selectedProjectId = activeProjects.some((project) => project.id === projectId) ? projectId : activeProjects[0]?.id || ""

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setCreatedPath(null)
    setListing(null)
    setPreferences(null)
    void Promise.all([
      worktreeService.preferences(),
      selectedProjectId ? worktreeService.list(selectedProjectId) : Promise.resolve(null),
    ]).then(([prefs, next]) => {
      if (cancelled) return
      setPreferences(prefs)
      setGlobalRoot(prefs.default_root ?? "")
      setProjectRoot(prefs.project_roots?.[selectedProjectId] ?? "")
      setListing(next)
      setRepository(next?.repositories.find((repo) => !repo.error)?.path ?? "")
      setRoot(next?.default_root ?? "")
    }).catch((failure) => { if (!cancelled) setError(getErrorMessage(failure)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, selectedProjectId])

  const run = async (action: () => Promise<void>) => {
    if (actionInFlight.current) return
    actionInFlight.current = true
    setBusy(true)
    setError(null)
    try { await action() } catch (failure) { setError(getErrorMessage(failure)) }
    finally { actionInFlight.current = false; setBusy(false) }
  }
  const refresh = async () => {
    if (selectedProjectId) setListing(await worktreeService.list(selectedProjectId))
  }
  const saveRoot = (scope?: string) => run(async () => {
    const value = scope ? projectRoot : globalRoot
    const next = await worktreeService.saveRoot(value.trim() ? value : null, scope)
    setPreferences(next)
    setGlobalRoot(next.default_root ?? "")
    setProjectRoot(next.project_roots?.[selectedProjectId] ?? "")
    setRoot(next.project_roots?.[selectedProjectId] ?? next.default_root ?? "")
    await refresh()
  })
  const openWorktree = (path: string) => run(async () => {
    // Binding grants the existing Project workspace authority; it is not a
    // worktree registry. Discovery always comes from Git, including CLI worktrees.
    const project = await projectService.getProject(selectedProjectId)
    if (project.project_path !== path && !(project.workspace_bindings ?? []).some((binding) => binding.path === path)) {
      await useAppStore.getState().bindWorkspace(project.id, project.revision, { path })
    }
    onOpen(selectedProjectId, path)
  })

  if (!open) return null
  return <ResponsiveDialog open onOpenChange={(next) => { if (!next && !busy) onClose() }}>
    <ResponsiveDialogContent className="gap-3 p-4" style={{ maxWidth: "56rem" }} dismissable={!busy} aria-describedby="worktrees-description">
      <ResponsiveDialogTitle className="flex items-center gap-2"><GitBranch className="size-5" />{uiText("worktrees_title")}</ResponsiveDialogTitle>
      <p id="worktrees-description" className="text-sm text-muted-foreground">{uiText("worktrees_description")}</p>
      {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
      {createdPath && <p role="status" className="break-all text-sm">{uiText("worktrees_created", { path: createdPath })}</p>}
      <div className="min-h-0 space-y-4 overflow-y-auto pr-1" style={{ maxHeight: "70dvh" }}>
        <section className="space-y-2 rounded-md border p-3">
          <label htmlFor="worktree-global-root" className="text-sm font-medium">{uiText("worktrees_global_root")}</label>
          <div className="flex gap-2"><Input id="worktree-global-root" value={globalRoot} disabled={loading || busy || !preferences} onChange={(event) => setGlobalRoot(event.target.value)} placeholder="/Volumes/External/worktree" />
            <Button variant="outline" disabled={loading || busy || !preferences} onClick={() => void saveRoot()}>{uiText("save_a3030bf8")}</Button></div>
          <p className="text-xs text-muted-foreground">{uiText("worktrees_root_hint")}</p>
        </section>
        <section className="space-y-3">
          <label htmlFor="worktree-project" className="text-sm font-medium">{uiText("worktrees_project")}</label>
          <select id="worktree-project" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={selectedProjectId} disabled={loading || busy} onChange={(event) => { setCreatedPath(null); setProjectId(event.target.value) }}>
            {!activeProjects.length && <option value="">{uiText("worktrees_no_projects")}</option>}
            {activeProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          {selectedProjectId && <><label htmlFor="worktree-project-root" className="text-sm">{uiText("worktrees_project_root")}</label>
            <div className="flex gap-2"><Input id="worktree-project-root" value={projectRoot} disabled={loading || busy || !preferences} onChange={(event) => setProjectRoot(event.target.value)} placeholder={uiText("worktrees_use_global")} />
              <Button variant="outline" disabled={loading || busy || !preferences} onClick={() => void saveRoot(selectedProjectId)}>{uiText("save_a3030bf8")}</Button></div></>}
        </section>
        {loading && <p role="status">{uiText("loading_4927a53b")}</p>}
        {listing && <>
          <div className="flex items-center justify-between"><h3 className="text-sm font-medium">{uiText("worktrees_repositories")}</h3>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(refresh)}><RefreshCw className="size-4" />{uiText("worktrees_refresh")}</Button></div>
          {!listing.repositories.length && <p className="text-sm text-muted-foreground">{uiText("worktrees_no_repositories")}</p>}
          {listing.repositories.map((repo) => <section key={repo.path} className="space-y-2 rounded-md border p-3">
            <h4 className="break-all text-xs text-muted-foreground">{repo.path}</h4>
            {repo.error && <p role="alert" className="break-words text-sm text-destructive">{repo.error}</p>}
            {repo.worktrees.map((entry) => <article key={entry.path} aria-label={entry.path} className="space-y-2 border-t pt-2 text-sm">
              <div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="font-medium">{entry.branch ?? uiText("worktrees_detached")}</div><div className="break-all text-xs text-muted-foreground">{entry.path}</div></div>
                <Button size="sm" variant="outline" disabled={busy || entry.prunable} onClick={() => void openWorktree(entry.path)}>{uiText("worktrees_open")}</Button></div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>{entry.dirty === null ? uiText("worktrees_unknown") : entry.dirty ? uiText("worktrees_dirty") : uiText("worktrees_clean")}</span>
                <span>{entry.occupied ? uiText("worktrees_occupied") : uiText("worktrees_idle")}</span>
                {entry.locked && <span>{uiText("worktrees_locked")}</span>}
                {entry.prunable && <span>{uiText("worktrees_unavailable")}</span>}
              </div>
              {entry.error && <p role="alert" className="break-words text-xs text-destructive">{entry.error}</p>}
              <div className="flex flex-wrap gap-1">{entry.sessions.length ? entry.sessions.map((session) => <Button key={session.id} variant="ghost" size="sm" disabled={busy} onClick={() => onSession(session.id)}>{session.title || session.id}{session.active ? ` · ${uiText("worktrees_active_session")}` : ""}</Button>) : <span className="text-xs text-muted-foreground">{uiText("worktrees_no_sessions")}</span>}</div>
            </article>)}
          </section>)}
          <form className="space-y-3 rounded-md border p-3" onSubmit={(event) => { event.preventDefault(); void run(async () => {
            const result = await worktreeService.create(selectedProjectId, { repository, root, name: name.trim(), branch: branch.trim() })
            setCreatedPath(result.path)
            setName("")
            setBranch("")
            await refresh()
          }) }}>
            <h3 className="text-sm font-medium">{uiText("worktrees_create")}</h3>
            <label htmlFor="worktree-repository" className="text-xs">{uiText("worktrees_repository")}</label>
            <select id="worktree-repository" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={repository} disabled={busy} onChange={(event) => setRepository(event.target.value)}>
              {listing.repositories.filter((repo) => !repo.error).map((repo) => <option key={repo.path} value={repo.path}>{repo.path}</option>)}
            </select>
            <label htmlFor="worktree-root" className="text-xs">{uiText("worktrees_create_root")}</label><Input id="worktree-root" required value={root} disabled={busy} onChange={(event) => setRoot(event.target.value)} />
            <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1"><label htmlFor="worktree-name" className="text-xs">{uiText("worktrees_folder")}</label><Input id="worktree-name" required pattern="[A-Za-z0-9_-]{1,80}" value={name} disabled={busy} onChange={(event) => setName(event.target.value)} /></div>
              <div className="space-y-1"><label htmlFor="worktree-branch" className="text-xs">{uiText("worktrees_branch")}</label><Input id="worktree-branch" required value={branch} disabled={busy} onChange={(event) => setBranch(event.target.value)} /></div></div>
            <p className="text-xs text-muted-foreground">{uiText("worktrees_target", { path: `${root.replace(/\/$/, "")}/${name}` })}</p>
            <Button type="submit" disabled={busy || !repository || !root.trim() || !name.trim() || !branch.trim()}>{uiText("worktrees_create")}</Button>
          </form>
        </>}
      </div>
    </ResponsiveDialogContent>
  </ResponsiveDialog>
}
