import { createMemo, createSignal, For, onSettled, Show } from "solid-js"
import { uiList } from "@shared/i18n/text"
import {
  MAX_MCP_IMPORT_BYTES, McpImportFailure, mcpIdsKey, parseMcpImport, previewMcpImport,
  type McpImportFailureKind,
} from "@services/mcp/importConfig"
import type { McpImportMode, McpImportRequest, McpImportResult } from "@services/mcp/types"
import { createUiText } from "../../shell/uiText"
import { Button } from "../../ui/button"
import { Textarea } from "../../ui/textarea"
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogTitle } from "../../ui/responsive-dialog"

export interface McpImportCompletion { result: McpImportResult; refreshed: boolean; reconciled?: boolean }
type Intent = { request: McpImportRequest; existingIds: string[] }
type Activity = "importing" | "reconciling" | "refreshing"
const importModes = ["merge", "replace"] as const

export function McpImportDialog(props: {
  existingIds: string[]
  listConfirmed: boolean
  listRevision: number
  onClose: () => void
  onReturnFocus: () => void
  onImport: (request: McpImportRequest, expectedIds: string[]) => Promise<McpImportCompletion>
  onReconcile: (request: McpImportRequest, expectedIds: string[]) => Promise<McpImportCompletion>
  onReload: () => Promise<boolean>
}) {
  const text = createUiText()
  const [draft, setDraft] = createSignal({ text: "", revision: 0 })
  const [mode, setMode] = createSignal<McpImportMode>("merge")
  const [acceptedKey, setAcceptedKey] = createSignal<string | null>(null)
  const [reading, setReading] = createSignal(false)
  const [activity, setActivity] = createSignal<Activity | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [failureKind, setFailureKind] = createSignal<McpImportFailureKind | null>(null)
  const [reconcileIntent, setReconcileIntent] = createSignal<Intent | null>(null)
  const [completion, setCompletion] = createSignal<McpImportCompletion | null>(null)
  let alive = true
  let busyGuard = false
  let fileRead = 0
  let cancelButton: HTMLButtonElement | undefined
  const focusCancel = () => cancelButton?.focus({ preventScroll: true })
  onSettled(() => {
    focusCancel()
    return () => { alive = false; ++fileRead }
  })

  const parsed = createMemo(() => parseMcpImport(draft().text))
  const parsedValue = () => {
    const result = parsed()
    return result.ok ? result.value : null
  }
  const parseError = () => {
    const result = parsed()
    return result.ok ? null : result.error
  }
  const preview = createMemo(() => previewMcpImport(parsedValue()?.servers.map((server) => server.id) ?? [], props.existingIds, mode()))
  // Only the input revision, mode and public inventory IDs identify a confirmation.
  const confirmationKey = () => JSON.stringify([draft().revision, mode(), props.listRevision,
    mcpIdsKey(props.existingIds), mcpIdsKey(preview().removed)])
  const confirmed = () => acceptedKey() === confirmationKey() && props.listConfirmed
  const uncertain = () => failureKind() === "uncertain"
  const busy = () => activity() !== null
  const canSubmit = () => Boolean(parsedValue() && props.listConfirmed && !busy() && !reading()
    && !uncertain() && !completion() && (mode() === "merge" || confirmed()))
  const resetOutcome = () => {
    setAcceptedKey(null)
    setError(null)
    setFailureKind(null)
    setReconcileIntent(null)
  }

  const edit = (value: string) => {
    if (busyGuard) return
    ++fileRead
    setReading(false)
    setDraft((previous) => ({ text: value, revision: previous.revision + 1 }))
    resetOutcome()
  }
  const selectFile = async (file: File | undefined) => {
    if (!file || busyGuard) return
    edit("")
    const generation = fileRead
    if (file.size > MAX_MCP_IMPORT_BYTES) { setError(text("json_files_must_be_at_most_1_mib_f27d4474")); return }
    setReading(true)
    try {
      const value = await file.text()
      if (alive && generation === fileRead) edit(value)
    } catch {
      if (alive && generation === fileRead) setError(text("could_not_read_the_json_file_select_it_again_or_paste_t_00aff047"))
    } finally {
      if (alive && generation === fileRead) setReading(false)
    }
  }
  const finish = (result: McpImportCompletion) => {
    setCompletion(result)
    setDraft((previous) => ({ text: "", revision: previous.revision + 1 }))
    resetOutcome()
  }
  const fail = (failure: unknown, intent?: Intent) => {
    const safe = failure instanceof McpImportFailure ? failure : new McpImportFailure("uncertain")
    setError(safe.message)
    setFailureKind(safe.kind)
    setAcceptedKey(null)
    setReconcileIntent(safe.kind === "uncertain" ? intent ?? null : null)
  }
  const reconcile = async (intent: Intent) => {
    try {
      const result = await props.onReconcile(intent.request, intent.existingIds)
      if (alive) finish(result)
    } catch (failure) {
      if (alive) fail(failure, intent)
    }
  }
  const submit = async () => {
    const value = parsedValue()
    if (busyGuard || !value || !canSubmit()) return
    const intent = { request: { mcpServers: value.mcpServers, mode: mode() }, existingIds: [...props.existingIds] }
    busyGuard = true
    setActivity("importing")
    setError(null)
    setFailureKind(null)
    setReconcileIntent(null)
    try {
      const result = await props.onImport(intent.request, intent.existingIds)
      if (alive) finish(result)
    } catch (failure) {
      if (!alive) return
      const safe = failure instanceof McpImportFailure ? failure : new McpImportFailure("uncertain")
      if (safe.kind === "uncertain") {
        setActivity("reconciling")
        await reconcile(intent)
      } else fail(safe)
    } finally {
      busyGuard = false
      if (alive) setActivity(null)
    }
  }
  const retryReconcile = async () => {
    const intent = reconcileIntent()
    if (busyGuard || !intent) return
    busyGuard = true
    setActivity("reconciling")
    setError(null)
    setFailureKind(null)
    try { await reconcile(intent) }
    finally {
      busyGuard = false
      if (alive) setActivity(null)
    }
  }
  const refresh = async () => {
    if (busyGuard) return
    busyGuard = true
    setActivity("refreshing")
    setAcceptedKey(null)
    setError(null)
    setFailureKind(null)
    const failed = () => {
      setError(text("could_not_refresh_the_actual_list_try_again_later_no_im_7b17ed25"))
      setFailureKind("list_unavailable")
    }
    try {
      const refreshed = await props.onReload()
      if (!alive) return
      const result = completion()
      if (result) setCompletion({ ...result, refreshed })
      if (!refreshed) failed()
    } catch {
      if (alive) failed()
    } finally {
      busyGuard = false
      if (alive) setActivity(null)
    }
  }
  const close = () => {
    if (busyGuard) return
    ++fileRead
    const returnFocus = props.onReturnFocus
    props.onClose()
    queueMicrotask(returnFocus)
  }

  return (
    <ResponsiveDialog open onOpenChange={(open) => { if (!open) close() }}>
      <ResponsiveDialogContent class="sm:max-w-2xl" dismissable={!busy()} showCloseButton={false}
        onCloseAutoFocus={(event: Event) => { event.preventDefault() }}
        onOpenAutoFocus={(event: Event) => { event.preventDefault(); focusCancel() }}>
        <div class="border-b px-4 py-3.5">
          <ResponsiveDialogTitle>{text("import_mcp_json_a41b0e8e")}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription class="mt-2 text-xs">
            {text("only_mcpservers_is_imported_configuration_stays_in_this_c3c8c01c")}
          </ResponsiveDialogDescription>
        </div>
        <div class="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <Show when={completion()} fallback={<>
            <label class="block space-y-1.5 text-xs">
              <span>{text("mcp_json_configuration_fa76d7f0")}</span>
              <Textarea value={draft().text} onInput={(event) => edit(event.currentTarget.value)} disabled={busy()}
                class="min-h-44 resize-y font-mono text-xs" autocomplete="off" autocapitalize="off" spellcheck={false}
                placeholder={'{"mcpServers":{"example":{"command":"mcp-server","disabled":true}}}'} />
            </label>
            <label class="block space-y-1.5 text-xs">
              <span>{text("choose_json_file_405a583f")}</span>
              <input type="file" accept=".json,application/json" disabled={busy()} class="block w-full min-w-0 text-xs"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0]
                  event.currentTarget.value = ""
                  void selectFile(file)
                }} />
            </label>
            <p class="text-xs text-muted-foreground">{text("at_most_1_mib_and_500_servers_preview_shows_only_ids_tr_06a6a9d6")}</p>
            <Show when={reading()}><p role="status" class="text-xs">{text("reading_json_file_eb7090c4")}</p></Show>
            <Show when={draft().revision > 0 && !reading() && !error() && parseError()}>
              <p role="alert" class="text-xs text-destructive">{parseError()}</p>
            </Show>
            <fieldset disabled={busy()} class="space-y-2">
              <legend class="mb-1 text-xs font-medium">{text("import_mode_6ac2e247")}</legend>
              <For each={importModes}>{(value) => <label class="flex items-center gap-2 text-sm">
                <input type="radio" name="mcp-import-mode" value={value} checked={mode() === value}
                  onChange={() => {
                    if (busyGuard) return
                    setMode(value)
                    resetOutcome()
                  }} />
                {text(value === "merge" ? "merge_by_id_40ecfb02" : "replace_all_02ac1ef7")}
              </label>}</For>
            </fieldset>
            <p class="text-xs text-muted-foreground">{text(mode() === "merge"
              ? "merge_replaces_the_entire_server_entry_for_each_matchin_ebcee6ab"
              : "replace_uses_the_imported_set_and_deletes_absent_ids_th_8eb5cdd1")}</p>
            <Show when={parsedValue()}>
              {(parsed) => <section aria-label={text("import_preview_7f1a08e3")} class="space-y-2 rounded-md border p-3 text-xs">
                <h3 class="font-medium">{text("import_preview_7f1a08e3")}</h3>
                <p>{text("expected_additions_9843ee0c")} {preview().added.length} {text("entire_entries_updated_5a95ad9f")} {preview().updated.length} {text("deleted_7dad13b3")} {preview().removed.length}</p>
                <ul class="max-h-36 space-y-1 overflow-y-auto">
                  <For each={parsed().servers}>{(server) => <li class="break-all">
                    <code>{server.id}</code> · {server.transport === "streamable_http" ? "Streamable HTTP" : server.transport} · {text(server.enabled ? "enabled_f4f0ead1" : "disable_4e6fd0e2")}
                  </li>}</For>
                </ul>
                <p>{text("server_ids_come_from_mcpservers_keys_internal_id_fields_9daa1d00")}</p>
                <Show when={mode() === "replace"}>
                  <div>
                    <p class="font-medium text-destructive">{text("existing_ids_to_delete_7831fba1")}</p>
                    <Show when={preview().removed.length > 0} fallback={<p>{text("none_484d5561")}</p>}>
                      <ul aria-label={text("servers_to_delete_c702db4b")} class="max-h-28 overflow-y-auto">
                        <For each={preview().removed}>{(id) => <li class="break-all"><code>{id}</code></li>}</For>
                      </ul>
                    </Show>
                    <label class="mt-3 flex items-start gap-2 text-sm">
                      <input type="checkbox" class="mt-1" checked={confirmed()} disabled={busy() || reading() || !props.listConfirmed}
                        onChange={(event) => setAcceptedKey(event.currentTarget.checked ? confirmationKey() : null)} />
                      {text("i_confirm_replacement_with_this_configuration_and_delet_d9dd018a")}
                    </label>
                  </div>
                </Show>
              </section>}
            </Show>
            <Show when={!props.listConfirmed}>
              <p role="alert" class="text-xs text-destructive">{text("the_current_server_list_is_unconfirmed_refresh_before_i_926117a1")}</p>
            </Show>
          </>}>
            {(result) => <section role="status" aria-label={text("import_result_e4039a16")} class="space-y-2 rounded-md border p-3 text-sm">
              <h3 class="font-medium">{text(result().reconciled ? "import_confirmed_44067475" : "import_completed_72695f79")}</h3>
              <p>{text("add_0006d696")} {result().result.added} {text("updated_b1b3836b")} {result().result.updated} {text("deleted_7dad13b3")} {result().result.removed}</p>
              <p class="break-all text-xs">{text("server_ids_4ab9d03b")}{uiList(result().result.server_ids)}</p>
              <p class="text-xs text-muted-foreground">{text(result().reconciled
                ? "the_actual_server_list_was_checked_automatically_import_c90ee703"
                : result().refreshed
                  ? "the_actual_server_list_and_runtime_state_were_refreshed_6aca294f"
                  : "configuration_submitted_runtime_state_will_refresh_auto_66de7fc4")}</p>
            </section>}
          </Show>
          <Show when={uncertain()} fallback={<Show when={error()}><p role="alert" class="text-xs text-destructive">{error()}</p></Show>}>
            <section role="status" class="space-y-1 rounded-md border p-3 text-xs">
              <h3 class="font-medium">{text("cannot_confirm_right_now_89a7e9d4")}</h3>
              <p class="text-muted-foreground">{error()} {text("check_again_or_close_this_dialog_and_inspect_the_server_e32df514")}</p>
            </section>
          </Show>
        </div>
        <div class="flex flex-wrap justify-end gap-2 border-t p-3">
          <Show when={uncertain() && reconcileIntent()}>
            <Button size="sm" variant="ghost" disabled={busy()} onClick={() => void retryReconcile()}>{text("check_again_a925d402")}</Button>
          </Show>
          <Show when={!completion() && !uncertain() && (!props.listConfirmed || failureKind() === "list_unavailable")}>
            <Button size="sm" variant="ghost" disabled={busy()} onClick={() => void refresh()}>{text("refresh_current_list_392bcf0e")}</Button>
          </Show>
          <Show when={completion() && !completion()?.refreshed}>
            <Button size="sm" variant="ghost" disabled={busy()} onClick={() => void refresh()}>{text("refresh_runtime_state_f55886a0")}</Button>
          </Show>
          <Button ref={(element) => { cancelButton = element }} size="sm" variant="secondary" disabled={busy()} onClick={close}>
            {text(completion() ? "done_c0b3fbff" : uncertain() ? "close_3fd47edc" : "cancel_2cd0f3be")}
          </Button>
          <Show when={!completion()}>
            <Button size="sm" disabled={!canSubmit()} onClick={() => void submit()}>
              {text(activity() === "importing" ? "importing_2f58b6ed" : activity() === "reconciling" ? "checking_0d32f419" : "import_576d81bb")}
            </Button>
          </Show>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
