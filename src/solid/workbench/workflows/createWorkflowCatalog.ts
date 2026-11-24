import { createEffect, createSignal, type Accessor } from "solid-js"
import { getErrorMessage } from "@services/api/errors"
import { getWorkflowCatalog, type WorkflowCatalog } from "@services/command/workflowCatalog"

export function createWorkflowCatalog(sessionId: Accessor<string>) {
  const [refresh, setRefresh] = createSignal(0)
  const [result, setResult] = createSignal<{
    sessionId: string
    catalog: WorkflowCatalog | null
    loading: boolean
    error: string | null
  } | null>(null)
  createEffect(() => [sessionId(), refresh()] as const, ([id]) => {
    const controller = new AbortController()
    const current = () => !controller.signal.aborted && sessionId() === id
    setResult({ sessionId: id, catalog: null, loading: true, error: null })
    void getWorkflowCatalog(id, controller.signal).then((catalog) => {
      if (current()) setResult({ sessionId: id, catalog, loading: false, error: null })
    }).catch((failure) => {
      if (current()) setResult({ sessionId: id, catalog: null, loading: false, error: getErrorMessage(failure) })
    })
    return () => controller.abort()
  })

  const scoped = () => {
    const current = result()
    return current?.sessionId === sessionId() ? current : null
  }
  return {
    catalog: () => scoped()?.catalog ?? null,
    loading: () => scoped()?.loading ?? true,
    error: () => scoped()?.error ?? null,
    refresh: () => setRefresh((value) => value + 1),
  }
}
