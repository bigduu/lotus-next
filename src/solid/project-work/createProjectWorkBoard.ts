import { createEffect, createMemo, createSignal, onSettled, type Accessor } from "solid-js"
import { getErrorMessage, isApiError } from "@services/api"
import { projectBoardClient, type ProjectBoardPage } from "@services/tickets/projectBoard"
import type { SprintFilter } from "@services/tickets/sprints"
import { createUiText } from "../shell/uiText"

export function createProjectWorkBoard(
  projectId: Accessor<string>, includeCancelled: Accessor<boolean>,
  filter: Accessor<SprintFilter | null>, owner: Accessor<boolean>,
) {
  const text = createUiText()
  const [revision, setRevision] = createSignal(0)
  const [page, setPage] = createSignal<ProjectBoardPage | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)
  const scope = createMemo(() => ({
    projectId: projectId(), cancelled: includeCancelled(), filter: filter(), owner: owner(), revision: revision(),
  }))
  let active: { scope: ReturnType<typeof scope>; controller: AbortController; paging: boolean } | undefined
  const current = (read: NonNullable<typeof active>) =>
    read === active && !read.controller.signal.aborted && scope() === read.scope
  const refresh = () => {
    active?.controller.abort()
    setPage(null)
    setRevision((value) => value + 1)
  }

  createEffect(scope, (query) => {
    const read = { scope: query, controller: new AbortController(), paging: false }
    active = read
    setPage(null)
    setError(null)
    setBusy(query.owner)
    if (query.owner) {
      void projectBoardClient.page(query.projectId, query.cancelled, undefined, read.controller.signal, query.filter)
        .then((next) => { if (current(read)) setPage(next) })
        .catch((failure) => {
          if (current(read)) setError(isApiError(failure) && failure.status === 404
            ? text("project_work_unsupported") : getErrorMessage(failure))
        })
        .finally(() => { if (current(read)) setBusy(false) })
    }
    return () => read.controller.abort()
  })
  onSettled(() => {
    window.addEventListener("online", refresh)
    return () => window.removeEventListener("online", refresh)
  })

  const loadMore = async () => {
    const firstPages = page()
    const read = active
    if (!firstPages?.next_cursor || !read || !current(read) || !read.scope.owner || busy() || read.paging) return
    read.paging = true
    setBusy(true)
    try {
      const next = await projectBoardClient.page(
        read.scope.projectId, read.scope.cancelled, firstPages, read.controller.signal, read.scope.filter,
      )
      if (current(read)) { setPage(next); setError(null) }
    } catch (failure) {
      if (!current(read)) return
      // An expired immutable cursor requires a new board snapshot.
      if (isApiError(failure) && [409, 410].includes(failure.status)) refresh()
      else setError(getErrorMessage(failure))
    } finally {
      read.paging = false
      if (current(read)) setBusy(false)
    }
  }

  return {
    page: () => {
      const value = page()
      return owner() && active?.scope === scope() ? value : null
    },
    error: () => {
      const value = error()
      return active?.scope === scope() ? value : null
    },
    busy: () => {
      const value = busy()
      return owner() && (active?.scope !== scope() || value)
    },
    refresh,
    loadMore,
  }
}
