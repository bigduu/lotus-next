import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useId, useRef, useState } from "react"
import { BookText, ChevronDown, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { getErrorMessage } from "@services/api/errors"
import { prepareWorkflowSelection, workflowUnavailableReason, type TypedWorkflowDraft } from "@services/command/workflowCatalog"
import type { WorkflowCatalogState } from "./useWorkflowCatalog"

export function WorkflowSelectionControl({ sessionId, selected, onChange, onRemove, open, onOpenChange,
  catalogState, disabled, error, onArgsFocus, onReturnFocus, variant = "composer",
}: {
  sessionId: string | null
  selected: TypedWorkflowDraft | null
  onChange: (value: TypedWorkflowDraft | null) => void
  onRemove: () => void
  open: boolean
  onOpenChange: (open: boolean) => void
  catalogState: WorkflowCatalogState
  disabled: boolean
  error: string | null
  onArgsFocus?: () => void
  onReturnFocus?: () => void
  variant?: "composer" | "environment"
}) {
  useUiLocale()
  const [query, setQuery] = useState("")
  const titleId = useId()
  const interactedOutside = useRef(false)
  const { catalog, loading, error: loadError, refresh } = catalogState
  let argsError: string | null = null
  if (selected) {
    try { prepareWorkflowSelection(selected) } catch (failure) { argsError = getErrorMessage(failure) }
  }
  const q = query.trim().toLowerCase()
  const entries = catalog?.entries.filter((entry) => !q || [entry.name, entry.id, entry.description, entry.source].some((text) => text.toLowerCase().includes(q))) ?? []
  const environment = variant === "environment"
  return (
    <Popover open={open} onOpenChange={(value) => { setQuery(""); onOpenChange(value) }}>
      <div className={environment ? "px-1" : "flex min-w-0 flex-wrap items-center gap-1 px-2 pt-1"} data-workflow-chip={environment ? undefined : ""}>
        <PopoverTrigger asChild>
          <button type="button" aria-label={selected ? uiText("edit_catalog_workflow_for_this_message_c2caaa3d", { v0: selected.entry.name }) : uiText("choose_a_catalog_workflow_for_this_message_9594a231")}
            className={environment
              ? "flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left hover:bg-accent"
              : "flex max-w-full items-center gap-1.5 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-medium text-primary hover:bg-accent"}>
            <BookText className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{selected ? selected.entry.name : uiText("choose_catalog_workflow_cf058476")}
              {environment && <span className="mt-0.5 block text-xs text-muted-foreground">{uiText("catalog_workflow_this_message_4bad8776")}</span>}
            </span>
            {!environment && <span className="shrink-0 text-[10px] opacity-70">{uiText("this_message_12a8838f")}</span>}
            <ChevronDown className="size-3 shrink-0 opacity-60" />
          </button>
        </PopoverTrigger>
        {!environment && selected && <button type="button" aria-label={uiText("remove_catalog_workflow_2388a457")} disabled={disabled} onClick={onRemove}
          className="rounded-full p-1 text-muted-foreground hover:bg-accent disabled:opacity-50"><X className="size-3.5" /></button>}
        {!environment && (error || argsError) && <p role="alert" className="basis-full break-words text-xs text-destructive">{error || argsError}</p>}
      </div>
      {open && <PopoverContent side={environment ? "left" : "top"} align="start"
        aria-labelledby={titleId} className="space-y-3 overflow-y-auto rounded-xl p-3 text-xs"
        style={{ width: "calc(var(--spacing) * 80)", maxHeight: "min(32rem, var(--radix-popover-content-available-height))", maxWidth: "calc(100vw - 1.5rem)" }}
        onOpenAutoFocus={() => { interactedOutside.current = false }}
        onInteractOutside={() => { interactedOutside.current = true }}
        onCloseAutoFocus={(event) => { if (onReturnFocus && !environment && !interactedOutside.current) { event.preventDefault(); onReturnFocus() } }}
        onFocusCapture={onArgsFocus}>
        <div className="flex items-center justify-between gap-2">
          <h3 id={titleId} className="font-medium">{uiText("catalog_workflow_this_message_4bad8776")}</h3>
          <button type="button" aria-label={uiText("close_workflow_catalog_c435e8e5")} onClick={() => onOpenChange(false)}><X className="size-4" /></button>
        </div>
        <p className="text-muted-foreground">{uiText("the_selected_workflow_runs_with_this_message_and_does_n_9786f97e")}</p>
        {!sessionId && <p className="text-muted-foreground">{uiText("new_sessions_show_general_workflows_only_open_a_project_a0386a25")}</p>}
        {selected && <div className="space-y-2 rounded-lg border bg-muted/30 p-2" data-workflow-selection>
          <div className="flex min-w-0 items-start gap-2"><span className="min-w-0 flex-1 break-words">{selected.entry.name} · {selected.entry.source} · r{selected.entry.revision}</span>
            <button type="button" aria-label={uiText("remove_selected_catalog_workflow_6b64a0d2")} disabled={disabled} onClick={onRemove}><X className="size-3.5" /></button></div>
          <p className="break-words text-muted-foreground">{selected.entry.description}</p>
          <label className="block space-y-1"><span>{uiText("workflow_arguments_json_7cca8c51")}</span>
            <Textarea aria-label={uiText("workflow_arguments_json_7cca8c51")} value={selected.argsText} disabled={disabled} onFocus={onArgsFocus}
              onChange={(event) => onChange({ ...selected, argsText: event.target.value })} rows={2} className="max-h-40 border text-xs" />
          </label>
          <details className="text-muted-foreground"><summary>{uiText("view_argument_schema_f39ae9e6")}</summary><pre className="whitespace-pre-wrap break-words">{JSON.stringify(selected.entry.argument_schema, null, 2)}</pre></details>
          {argsError && <p role="alert">{argsError}</p>}
        </div>}
        {error && <p role="alert" className="break-words text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Input aria-label={uiText("search_catalog_workflows_0d8bffd7")} placeholder={uiText("search_catalog_workflows_d2735d7b")} value={query} onChange={(event) => setQuery(event.target.value)} className="h-8 text-xs" />
          <Button type="button" size="sm" variant="outline" disabled={loading} onClick={refresh}>{uiText("refresh_aee88743")}</Button>
        </div>
        {loading && <p role="status">{uiText("loading_workflow_catalog_59214f82")}</p>}
        {loadError && <p role="alert">{uiText("could_not_load_catalog_a2342d5f")}{loadError}</p>}
        {!loading && !loadError && <div className="max-h-60 space-y-1 overflow-y-auto" aria-label={uiText("workflows_in_catalog_0f32be5f")}>
          {entries.map((entry) => {
            const reason = workflowUnavailableReason(entry)
            return <button key={`${entry.kind}:${entry.id}:${entry.source}:${entry.revision}`} type="button" disabled={disabled || !!reason}
              onClick={() => { if (disabled || reason) return; onChange({ entry, argsText: "{}" }); onOpenChange(false) }}
              className="block w-full rounded-lg px-2 py-2 text-left hover:bg-accent disabled:opacity-50">
              <span className="block font-medium">{entry.name} <span className="font-normal text-muted-foreground">{entry.source} · r{entry.revision}</span></span>
              <span className="block text-muted-foreground">{reason || entry.description}</span>
            </button>
          })}
          {!entries.length && <p className="py-2 text-muted-foreground">{q ? uiText("no_matching_catalog_workflows_de80e22d") : uiText("no_workflows_in_catalog_yet_3aa5c7a8")}</p>}
        </div>}
      </PopoverContent>}
    </Popover>
  )
}
