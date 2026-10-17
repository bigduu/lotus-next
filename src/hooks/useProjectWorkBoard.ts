import { useCallback, useContext, useEffect, useRef, useState } from "react"
import { getErrorMessage, isApiError } from "@services/api"
import { projectBoardClient, type ProjectBoardPage } from "@services/tickets/projectBoard"
import { uiText, useUiLocale } from "@shared/i18n/ui"
import { OwnerAccessContext } from "./ownerAccessContext"

export function useProjectWorkBoard(projectId: string, includeCancelled: boolean) {
  useUiLocale()
  const owner = useContext(OwnerAccessContext)
  const [page, setPage] = useState<ProjectBoardPage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const loadingMore = useRef(false)
  const active = useRef<AbortController | null>(null)
  const refresh = useCallback(() => { active.current?.abort(); setPage(null); setRevision((n) => n + 1) }, [])
  useEffect(() => {
    const controller = new AbortController()
    active.current = controller
    loadingMore.current = false
    setPage(null); setError(null); setBusy(owner)
    if (owner) void projectBoardClient.page(projectId, includeCancelled, undefined, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setPage(result) })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(isApiError(failure) && failure.status === 404 ? uiText("project_work_unsupported") : getErrorMessage(failure))
      }).finally(() => { if (!controller.signal.aborted) setBusy(false) })
    window.addEventListener("online", refresh)
    return () => { controller.abort(); window.removeEventListener("online", refresh) }
  }, [projectId, includeCancelled, owner, revision, refresh])
  const loadMore = async () => {
    if (!page?.next_cursor || busy || loadingMore.current || !owner || active.current?.signal.aborted) return
    const controller = active.current!
    loadingMore.current = true
    setBusy(true)
    try {
      const result = await projectBoardClient.page(projectId, includeCancelled, page, controller.signal)
      if (!controller.signal.aborted) { setPage(result); setError(null) }
    } catch (failure) {
      if (controller.signal.aborted) return
      // An expired immutable snapshot cannot be patched with newer pages.
      if (isApiError(failure) && [409, 410].includes(failure.status)) refresh()
      else setError(getErrorMessage(failure))
    } finally { if (!controller.signal.aborted) { loadingMore.current = false; setBusy(false) } }
  }
  return { page: owner ? page : null, error, busy, refresh, loadMore, owner }
}
