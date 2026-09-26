import { useEffect, useRef, useState } from "react"
import { BookText, ChevronDown, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { getErrorMessage } from "@services/api/errors"
import {
  getWorkflowCatalog, prepareWorkflowSelection, workflowUnavailableReason,
  type TypedWorkflowDraft, type WorkflowCatalog,
} from "@services/command/workflowCatalog"

export function WorkflowSelectionControl({ sessionId, selected, onChange, disabled, error, onArgsFocus }: {
  sessionId: string | null
  selected: TypedWorkflowDraft | null
  onChange: (value: TypedWorkflowDraft | null) => void
  disabled: boolean
  error: string | null
  /** Command menus listen to textarea keys; dismiss them before editing JSON. */
  onArgsFocus?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [catalog, setCatalog] = useState<WorkflowCatalog | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  const generation = useRef(0)
  useEffect(() => {
    if (!open) return
    const id = ++generation.current
    const controller = new AbortController()
    setLoading(true); setLoadError(null)
    void getWorkflowCatalog(sessionId, controller.signal).then((value) => {
      if (id === generation.current) setCatalog(value)
    }).catch((failure) => {
      if (id === generation.current) { setCatalog(null); setLoadError(getErrorMessage(failure)) }
    }).finally(() => { if (id === generation.current) setLoading(false) })
    return () => { generation.current += 1; controller.abort() }
  }, [open, sessionId, refresh])
  let argsError: string | null = null
  if (selected) {
    try { prepareWorkflowSelection(selected) } catch (failure) { argsError = getErrorMessage(failure) }
  }
  return (
    <div className="mx-auto mb-2 w-full max-w-6xl">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
        className="flex max-w-full items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground">
        <BookText className="size-3.5 shrink-0" />
        <span className="truncate">{selected ? `目录工作流 · ${selected.entry.name}` : "选择目录工作流"}</span>
        <ChevronDown className="size-3 shrink-0 opacity-60" />
      </button>
      {(open || selected || error) && (
        <div className="mt-2 space-y-2 rounded-lg border bg-card p-3 text-xs" data-workflow-selection>
          <p className="text-muted-foreground">目录选择会发送来源、版本和参数。旧 /工作流入口只展开文本。</p>
          {!sessionId && <p className="text-muted-foreground">新会话使用全局目录；Bamboo 会按创建后的项目和工作目录重新校验。</p>}
          {open && <>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => setRefresh((n) => n + 1)}>刷新 Workflow 目录</Button>
              {loading && <span role="status">正在读取 Workflow 目录…</span>}
            </div>
            {loadError && <p role="alert">目录读取失败：{loadError}</p>}
            {catalog && !loading && <>
              <label className="block space-y-1">
                <span>目录中的 Workflow</span>
                <select aria-label="目录中的 Workflow" value="" disabled={disabled}
                  className="w-full rounded border bg-background p-2 text-xs"
                  onChange={(event) => {
                    if (!event.target.value) return
                    const entry = catalog.entries[Number(event.target.value)]
                    if (entry && !workflowUnavailableReason(entry)) onChange({ entry, argsText: "{}" })
                  }}>
                  <option value="">选择一个明确版本…</option>
                  {catalog.entries.map((entry, i) => {
                    const reason = workflowUnavailableReason(entry)
                    return <option key={`${entry.kind}:${entry.id}:${entry.source}:${i}`} value={i} disabled={!!reason}>
                      {entry.name} · {entry.source} · r{entry.revision}{reason ? ` · ${reason}` : ""}
                    </option>
                  })}
                </select>
              </label>
              {catalog.entries.length === 0 && <p>目录中暂无 Workflow。</p>}
            </>}
          </>}
          {selected && <>
            <div className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 flex-1 break-words">{selected.entry.name} · {selected.entry.id} · {selected.entry.source} · r{selected.entry.revision}</span>
              <button type="button" aria-label="移除目录工作流" disabled={disabled} onClick={() => onChange(null)}><X className="size-3.5" /></button>
            </div>
            <p className="break-words text-muted-foreground">{selected.entry.description}</p>
            <label className="block space-y-1">
              <span>Workflow 参数（JSON）</span>
              <Textarea aria-label="Workflow 参数（JSON）" value={selected.argsText} disabled={disabled}
                onFocus={onArgsFocus}
                onChange={(event) => onChange({ ...selected, argsText: event.target.value })}
                rows={2} className="max-h-40 text-xs" />
            </label>
            <details className="text-muted-foreground"><summary>查看参数 schema</summary><pre className="whitespace-pre-wrap break-words">{JSON.stringify(selected.entry.argument_schema, null, 2)}</pre></details>
            {argsError && <p role="alert">{argsError}</p>}
          </>}
          {error && <p role="alert" className="break-words">{error}</p>}
        </div>
      )}
    </div>
  )
}
