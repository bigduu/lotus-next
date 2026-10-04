import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"
import {
  MAX_MCP_IMPORT_BYTES, McpImportFailure, mcpIdsKey, parseMcpImport, previewMcpImport,
  type McpImportFailureKind,
} from "@services/mcp/importConfig"
import type { McpImportMode, McpImportRequest, McpImportResult } from "@services/mcp/types"

export interface McpImportCompletion { result: McpImportResult; refreshed: boolean; reconciled?: boolean }
type ReconcileIntent = { request: McpImportRequest; existingIds: string[] }
type Activity = "importing" | "reconciling" | "refreshing"

export function McpImportDialog({ existingIds, listConfirmed, listRevision, onClose, onReturnFocus, onImport, onReconcile, onReload }: {
  existingIds: string[]
  listConfirmed: boolean
  listRevision: number
  onClose: () => void
  onReturnFocus: () => void
  onImport: (request: McpImportRequest, expectedIds: string[]) => Promise<McpImportCompletion>
  onReconcile: (request: McpImportRequest, expectedIds: string[]) => Promise<McpImportCompletion>
  onReload: () => Promise<boolean>
}) {
  useUiLocale()
  const [draft, setDraft] = useState({ text: "", revision: 0 })
  const [mode, setMode] = useState<McpImportMode>("merge")
  const [acceptedKey, setAcceptedKey] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [activity, setActivity] = useState<Activity | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [failureKind, setFailureKind] = useState<McpImportFailureKind | null>(null)
  const [reconcileIntent, setReconcileIntent] = useState<ReconcileIntent | null>(null)
  const [completion, setCompletion] = useState<McpImportCompletion | null>(null)
  const alive = useRef(true)
  const busyRef = useRef(false)
  const fileRead = useRef(0)
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; fileRead.current += 1 }
  }, [])

  const parsed = useMemo(() => parseMcpImport(draft.text), [draft.text])
  const ids = parsed.ok ? parsed.value.servers.map((server) => server.id) : []
  const preview = previewMcpImport(ids, existingIds, mode)
  const existingKey = mcpIdsKey(existingIds)
  // No JSON or secret-bearing content in the confirmation token.
  const confirmationKey = JSON.stringify([draft.revision, mode, listRevision, existingKey, mcpIdsKey(preview.removed)])
  const confirmed = acceptedKey === confirmationKey && listConfirmed
  const uncertain = failureKind === "uncertain"
  const busy = activity !== null
  const canSubmit = parsed.ok && listConfirmed && !busy && !reading && !uncertain && !completion && (mode === "merge" || confirmed)

  const edit = (text: string) => {
    if (busyRef.current) return
    fileRead.current += 1
    setReading(false)
    setDraft((previous) => ({ text, revision: previous.revision + 1 }))
    setAcceptedKey(null); setError(null); setFailureKind(null); setReconcileIntent(null)
  }
  const selectFile = async (file: File | undefined) => {
    if (!file || busyRef.current) return
    edit("")
    const generation = fileRead.current
    if (file.size > MAX_MCP_IMPORT_BYTES) { setError(uiText("json_files_must_be_at_most_1_mib_f27d4474")); return }
    setReading(true)
    try {
      const text = await file.text()
      if (!alive.current || generation !== fileRead.current) return
      edit(text)
    } catch {
      if (alive.current && generation === fileRead.current) setError(uiText("could_not_read_the_json_file_select_it_again_or_paste_t_00aff047"))
    } finally {
      if (alive.current && generation === fileRead.current) setReading(false)
    }
  }
  const finish = (result: McpImportCompletion) => {
    setCompletion(result)
    setDraft((previous) => ({ text: "", revision: previous.revision + 1 }))
    setAcceptedKey(null); setError(null); setFailureKind(null); setReconcileIntent(null)
  }
  const fail = (failure: unknown, intent?: ReconcileIntent) => {
    const safe = failure instanceof McpImportFailure ? failure : new McpImportFailure("uncertain")
    setError(safe.message); setFailureKind(safe.kind); setAcceptedKey(null)
    setReconcileIntent(safe.kind === "uncertain" ? intent ?? null : null)
  }
  const reconcile = async (intent: ReconcileIntent) => {
    try {
      const result = await onReconcile(intent.request, intent.existingIds)
      if (alive.current) finish(result)
    } catch (failure) {
      if (alive.current) fail(failure, intent)
    }
  }
  const submit = async () => {
    if (busyRef.current || !canSubmit || !parsed.ok) return
    const intent = { request: { mcpServers: parsed.value.mcpServers, mode }, existingIds: [...existingIds] }
    busyRef.current = true
    setActivity("importing"); setError(null); setFailureKind(null); setReconcileIntent(null)
    try {
      const result = await onImport(intent.request, intent.existingIds)
      if (!alive.current) return
      finish(result)
    } catch (failure) {
      if (!alive.current) return
      const safe = failure instanceof McpImportFailure ? failure : new McpImportFailure("uncertain")
      if (safe.kind === "uncertain") { setActivity("reconciling"); await reconcile(intent) }
      else fail(safe)
    } finally {
      busyRef.current = false
      if (alive.current) setActivity(null)
    }
  }
  const retryReconcile = async () => {
    if (busyRef.current || !reconcileIntent) return
    busyRef.current = true
    setActivity("reconciling"); setError(null); setFailureKind(null)
    try {
      await reconcile(reconcileIntent)
    } finally {
      busyRef.current = false
      if (alive.current) setActivity(null)
    }
  }
  const refresh = async () => {
    if (busyRef.current) return
    busyRef.current = true; setActivity("refreshing"); setAcceptedKey(null); setError(null); setFailureKind(null)
    try {
      const refreshed = await onReload()
      if (!alive.current) return
      if (completion) setCompletion({ ...completion, refreshed })
      if (!refreshed) { setError(uiText("could_not_refresh_the_actual_list_try_again_later_no_im_7b17ed25")); setFailureKind("list_unavailable") }
    } catch {
      if (alive.current) { setError(uiText("could_not_refresh_the_actual_list_try_again_later_no_im_7b17ed25")); setFailureKind("list_unavailable") }
    } finally {
      busyRef.current = false
      if (alive.current) setActivity(null)
    }
  }
  const close = () => { if (!busyRef.current) { fileRead.current += 1; onClose() } }

  return (
    <ResponsiveDialog open onOpenChange={(open) => { if (!open) close() }}>
      <ResponsiveDialogContent className="sm:max-w-2xl" dismissable={!busy} showCloseButton={false}
        onCloseAutoFocus={(event) => { event.preventDefault(); onReturnFocus() }}
        onOpenAutoFocus={(event) => { event.preventDefault(); cancel.current?.focus() }}>
        <div className="border-b px-4 py-3.5">
          <ResponsiveDialogTitle>{uiText("import_mcp_json_a41b0e8e")}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="mt-2 text-xs">
            {uiText("only_mcpservers_is_imported_configuration_stays_in_this_c3c8c01c")}</ResponsiveDialogDescription>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {completion ? (
            <section role="status" aria-label={uiText("import_result_e4039a16")} className="space-y-2 rounded-md border p-3 text-sm">
              <h3 className="font-medium">{completion.reconciled ? uiText("import_confirmed_44067475") : uiText("import_completed_72695f79")}</h3>
              <p>{uiText("add_0006d696")} {completion.result.added} {uiText("updated_b1b3836b")} {completion.result.updated} {uiText("deleted_7dad13b3")} {completion.result.removed}</p>
              <p className="break-all text-xs">{uiText("server_ids_4ab9d03b")}{completion.result.server_ids.join("、")}</p>
              <p className="text-xs text-muted-foreground">{completion.reconciled
                ? uiText("the_actual_server_list_was_checked_automatically_import_c90ee703")
                : completion.refreshed
                  ? uiText("the_actual_server_list_and_runtime_state_were_refreshed_6aca294f")
                  : uiText("configuration_submitted_runtime_state_will_refresh_auto_66de7fc4")}</p>
            </section>
          ) : (
            <>
              <label className="block space-y-1.5 text-xs">
                <span>{uiText("mcp_json_configuration_fa76d7f0")}</span>
                <Textarea value={draft.text} onChange={(event) => edit(event.target.value)} disabled={busy}
                  className="min-h-44 resize-y font-mono text-xs" autoComplete="off" autoCapitalize="off" spellCheck={false}
                  placeholder={'{"mcpServers":{"example":{"command":"mcp-server","disabled":true}}}'} />
              </label>
              <label className="block space-y-1.5 text-xs">
                <span>{uiText("choose_json_file_405a583f")}</span>
                <input type="file" accept=".json,application/json" disabled={busy} className="block w-full min-w-0 text-xs"
                  onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void selectFile(file) }} />
              </label>
              <p className="text-xs text-muted-foreground">{uiText("at_most_1_mib_and_500_servers_preview_shows_only_ids_tr_06a6a9d6")}</p>
              {reading ? <p role="status" className="text-xs">{uiText("reading_json_file_eb7090c4")}</p> : null}
              {/* The revision records an attempted input even when a selected file is empty. */}
              {draft.revision > 0 && !reading && !error && !parsed.ok ? <p role="alert" className="text-xs text-destructive">{parsed.error}</p> : null}
              <fieldset disabled={busy} className="space-y-2">
                <legend className="mb-1 text-xs font-medium">{uiText("import_mode_6ac2e247")}</legend>
                {(["merge", "replace"] as const).map((value) => (
                  <label key={value} className="flex items-center gap-2 text-sm">
                    <input type="radio" name="mcp-import-mode" value={value} checked={mode === value} onChange={() => {
                      if (busyRef.current) return
                      setMode(value); setAcceptedKey(null); setError(null); setFailureKind(null); setReconcileIntent(null)
                    }} />
                    {value === "merge" ? uiText("merge_by_id_40ecfb02") : uiText("replace_all_02ac1ef7")}
                  </label>
                ))}
              </fieldset>
              <p className="text-xs text-muted-foreground">{mode === "merge"
                ? uiText("merge_replaces_the_entire_server_entry_for_each_matchin_ebcee6ab")
                : uiText("replace_uses_the_imported_set_and_deletes_absent_ids_th_8eb5cdd1")}</p>
              {parsed.ok ? (
                <section aria-label={uiText("import_preview_7f1a08e3")} className="space-y-2 rounded-md border p-3 text-xs">
                  <h3 className="font-medium">{uiText("import_preview_7f1a08e3")}</h3>
                  <p>{uiText("expected_additions_9843ee0c")} {preview.added.length} {uiText("entire_entries_updated_5a95ad9f")} {preview.updated.length} {uiText("deleted_7dad13b3")} {preview.removed.length}</p>
                  <ul className="max-h-36 space-y-1 overflow-y-auto">
                    {parsed.value.servers.map((server) => <li key={server.id} className="break-all">
                      <code>{server.id}</code> · {server.transport === "streamable_http" ? "Streamable HTTP" : server.transport} · {server.enabled ? uiText("enabled_f4f0ead1") : uiText("disable_4e6fd0e2")}
                    </li>)}
                  </ul>
                  <p>{uiText("server_ids_come_from_mcpservers_keys_internal_id_fields_9daa1d00")}</p>
                  {mode === "replace" ? <div>
                    <p className="font-medium text-destructive">{uiText("existing_ids_to_delete_7831fba1")}</p>
                    {preview.removed.length ? <ul aria-label={uiText("servers_to_delete_c702db4b")} className="max-h-28 overflow-y-auto">
                      {preview.removed.map((id) => <li key={id} className="break-all"><code>{id}</code></li>)}
                    </ul> : <p>{uiText("none_484d5561")}</p>}
                    <label className="mt-3 flex items-start gap-2 text-sm">
                      <input type="checkbox" className="mt-1" checked={confirmed} disabled={busy || reading || !listConfirmed}
                        onChange={(event) => setAcceptedKey(event.target.checked ? confirmationKey : null)} />
                      {uiText("i_confirm_replacement_with_this_configuration_and_delet_d9dd018a")}</label>
                  </div> : null}
                </section>
              ) : null}
              {!listConfirmed ? <p role="alert" className="text-xs text-destructive">{uiText("the_current_server_list_is_unconfirmed_refresh_before_i_926117a1")}</p> : null}
            </>
          )}
          {uncertain ? (
            <section role="status" className="space-y-1 rounded-md border p-3 text-xs">
              <h3 className="font-medium">{uiText("cannot_confirm_right_now_89a7e9d4")}</h3>
              <p className="text-muted-foreground">{error} {uiText("check_again_or_close_this_dialog_and_inspect_the_server_e32df514")}</p>
            </section>
          ) : error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t p-3">
          {uncertain && reconcileIntent ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => void retryReconcile()}>{uiText("check_again_a925d402")}</Button> : null}
          {!completion && !uncertain && (!listConfirmed || failureKind === "list_unavailable") ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => void refresh()}>{uiText("refresh_current_list_392bcf0e")}</Button> : null}
          {completion && !completion.refreshed ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => void refresh()}>{uiText("refresh_runtime_state_f55886a0")}</Button> : null}
          <Button ref={cancel} size="sm" variant="secondary" disabled={busy} onClick={close}>{completion ? uiText("done_c0b3fbff") : uncertain ? uiText("close_3fd47edc") : uiText("cancel_2cd0f3be")}</Button>
          {!completion ? <Button size="sm" disabled={!canSubmit} onClick={() => void submit()}>{activity === "importing" ? uiText("importing_2f58b6ed") : activity === "reconciling" ? uiText("checking_0d32f419") : uiText("import_576d81bb")}</Button> : null}
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
