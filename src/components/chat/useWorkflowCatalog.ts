import { useEffect, useState } from "react"
import { getErrorMessage } from "@services/api/errors"
import { getWorkflowCatalog, type WorkflowCatalog } from "@services/command/workflowCatalog"

/** One session-scoped catalog shared by both pickers and the slash menu. */
export function useWorkflowCatalog(sessionId: string | null, active: boolean) {
  const [refresh, setRefresh] = useState(0)
  const [result, setResult] = useState<{
    sessionId: string | null; catalog: WorkflowCatalog | null; loading: boolean; error: string | null
  } | null>(null)
  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    let current = true
    setResult({ sessionId, catalog: null, loading: true, error: null })
    void getWorkflowCatalog(sessionId, controller.signal).then((catalog) => {
      if (current) setResult({ sessionId, catalog, loading: false, error: null })
    }).catch((failure) => {
      if (current) setResult({ sessionId, catalog: null, loading: false, error: getErrorMessage(failure) })
    })
    return () => { current = false; controller.abort() }
  }, [sessionId, active, refresh])
  // A render for a new authority must never expose the previous session's rows.
  const scoped = result?.sessionId === sessionId ? result : null
  return {
    catalog: scoped?.catalog ?? null,
    loading: active && (!scoped || scoped.loading),
    error: scoped?.error ?? null,
    refresh: () => setRefresh((value) => value + 1),
  }
}
export type WorkflowCatalogState = ReturnType<typeof useWorkflowCatalog>
