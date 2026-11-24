import { createMemo, createSignal, onSettled } from "solid-js"
import { configShareService, ConfigShareError } from "@services/config/ConfigShareService"
import { providerStore } from "@shared/store/appStore/slices/providerState"
import { appStore } from "@shared/store/appStore/state"
import { getRuntimeModelIds } from "@shared/types/providerConfig"
import {
  emptyShareDecisions, emptyShareSelection, MAX_SHARE_PASSPHRASE_BYTES, MIN_SHARE_PASSPHRASE_BYTES,
  type ShareChoice, type ShareDecisions, type ShareInventory, type ShareOperation, type SharePreviewResponse,
  type ShareProviderPreview, type ShareRevisions, type ShareSelection,
} from "@shared/types/configShare"
import { createUiText } from "../../shell/uiText"

interface PreviewRow {
  group: keyof ShareDecisions
  id: string
  label: string
  conflict: boolean
  secret: boolean
  provider?: ShareProviderPreview
}

type Phase = "export" | "preview" | "apply" | "check" | "copy" | "refresh"
type Pending = { id: string; expected: ShareRevisions }
type Recovery = { revisions: ShareRevisions; error: string }

const rowsFor = ({ preview }: SharePreviewResponse): PreviewRow[] => [
  ...preview.providers.map((row) => ({
    group: "providers" as const, id: row.id, label: row.label ? `${row.label} (${row.id})` : row.id,
    conflict: row.conflict, secret: row.has_api_key, provider: row,
  })),
  ...preview.scenarios.map((row) => ({
    group: "scenarios" as const, id: row.scenario, label: `${row.scenario}: ${row.provider} / ${row.model}`,
    conflict: row.conflict, secret: false,
  })),
  ...preview.subagent_models.map((row) => ({
    group: "subagent_models" as const, id: row.name, label: `${row.name}: ${row.provider} / ${row.model}`,
    conflict: row.conflict, secret: false,
  })),
  ...preview.env.map((row) => ({
    group: "env" as const, id: row.name, label: row.name, conflict: row.conflict, secret: row.has_value,
  })),
]

const toggle = <T,>(values: T[], value: T, checked: boolean): T[] =>
  checked ? [...new Set([...values, value])] : values.filter((item) => item !== value)
const asciiCaseFold = (value: string): string => value.replace(/[A-Z]/g, (letter) => letter.toLowerCase())
const defaultChoice: ShareChoice = { action: "replace" }

function revokeClientAuthority() {
  providerStore.getState().invalidateProviderState()
  appStore.getState().setSavedModelOptions([])
}

async function reloadClientAuthority(revisions?: ShareRevisions) {
  // Read saved authority only. Catalog discovery may contact providers.
  revokeClientAuthority()
  await configShareService.waitForProviderRefresh(revisions)
  const snapshot = await providerStore.getState().loadProviderInstances()
  const current = providerStore.getState()
  if (current.providerStatus !== "ready" || current.providerSnapshot !== snapshot) throw new ConfigShareError("unavailable")
  appStore.getState().setSavedModelOptions(snapshot.instances.filter((instance) => instance.enabled)
    .flatMap((instance) => getRuntimeModelIds(instance, snapshot.defaults)))
}

export function createConfigShare() {
  const text = createUiText()
  const [inventory, setInventory] = createSignal<ShareInventory>()
  const [loading, setLoading] = createSignal(true)
  const [selection, setSelection] = createSignal(emptyShareSelection())
  const [includeSecrets, setIncludeSecrets] = createSignal(false)
  const [exportPassphrase, setExportPassphrase] = createSignal("")
  const [exported, setExported] = createSignal("")
  const [shareString, setShareString] = createSignal("")
  const [importPassphrase, setImportPassphrase] = createSignal("")
  const [preview, setPreview] = createSignal<SharePreviewResponse>()
  const [decisions, setDecisions] = createSignal(emptyShareDecisions())
  const [reviewed, setReviewed] = createSignal(false)
  const [receipt, setReceipt] = createSignal<ShareOperation>()
  const [pending, setPending] = createSignal<Pending>()
  const [refreshRequired, setRefreshRequired] = createSignal(false)
  const [recovery, setRecovery] = createSignal<Recovery>()
  const [error, setError] = createSignal<string>()
  const [status, setStatus] = createSignal<string>()
  const [busy, setBusy] = createSignal<Phase>()
  let phase: Phase | undefined
  let generation = 0
  let request: AbortController | undefined
  let mounted = true

  const current = (epoch: number) => mounted && epoch === generation
  const needsReconciliation = () => !!pending() || refreshRequired() || !!recovery()
  const locked = () => !!busy() || needsReconciliation()
  const canEdit = () => mounted && !phase && !needsReconciliation()
  const canCancel = () => busy() !== "apply" && busy() !== "check" && busy() !== "refresh" && !pending()
  const rows = createMemo(() => {
    const snapshot = preview()
    return snapshot ? rowsFor(snapshot) : []
  })
  const choiceFor = (row: PreviewRow) => {
    const group: Record<string, ShareChoice | undefined> = decisions()[row.group]
    return Object.hasOwn(group, row.id) ? group[row.id] ?? defaultChoice : defaultChoice
  }
  const canExport = createMemo(() => {
    const selected = selection()
    if (!inventory() || !(selected.providers.length || selected.scenarios.length || selected.subagent_models.length || Object.keys(selected.env).length)) return false
    const passphrase = exportPassphrase()
    const sensitive = selected.provider_api_keys.length > 0 || Object.values(selected.env).some(Boolean)
    if (!sensitive && !passphrase) return true
    const bytes = new TextEncoder().encode(passphrase).length
    return !!passphrase.trim() && bytes >= MIN_SHARE_PASSPHRASE_BYTES && bytes <= MAX_SHARE_PASSPHRASE_BYTES
  })
  const canApply = createMemo(() => {
    const snapshot = preview()
    if (!snapshot || snapshot.apply_blocked || !reviewed()) return false
    return rows().every((row) => {
      const choice = choiceFor(row)
      if (choice.action !== "rename") return choice.action === "skip" || row.provider?.replace_allowed !== false
      const sameName = row.group === "env" ? asciiCaseFold(choice.target) === asciiCaseFold(row.id) : choice.target === row.id
      return row.group !== "scenarios" && row.provider?.rename_allowed !== false && !!choice.target.trim() && !sameName
    })
  })

  function clearPreview() {
    setPreview(undefined)
    setDecisions(emptyShareDecisions())
    setReviewed(false)
  }

  function clearDrafts() {
    setShareString("")
    setImportPassphrase("")
    setExportPassphrase("")
    setExported("")
    setIncludeSecrets(false)
    setSelection(emptyShareSelection())
    clearPreview()
  }

  onSettled(() => {
    void configShareService.inventory().then((value) => {
      if (mounted) setInventory(value)
    }).catch(() => {
      if (mounted) setError(text("share_inventory_failed"))
    }).finally(() => {
      if (mounted) setLoading(false)
    })
    return () => {
      mounted = false
      generation += 1
      request?.abort()
      request = undefined
      setPending(undefined)
      clearDrafts()
    }
  })

  function start(next: Phase) {
    if (!mounted || phase) return false
    phase = next
    setBusy(next)
    setError(undefined)
    setStatus(undefined)
    return true
  }

  function finish(epoch: number) {
    if (!current(epoch)) return
    phase = undefined
    setBusy(undefined)
    request = undefined
  }

  function invalidatePreview() {
    generation += 1
    clearPreview()
    setReceipt(undefined)
    setRefreshRequired(false)
    setStatus(undefined)
    setError(recovery() ? text("share_current_refresh_failed") : undefined)
  }

  function cancel() {
    if (phase === "apply" || phase === "check" || phase === "refresh" || pending()) return
    request?.abort()
    request = undefined
    phase = undefined
    setBusy(undefined)
    if (receipt()?.state === "committed" && refreshRequired()) {
      // Keep only the receipt that allows retrying the saved authority read.
      generation += 1
      setStatus(text("share_saved"))
      setError(text("share_saved_refresh_failed"))
    } else {
      invalidatePreview()
    }
    clearDrafts()
  }

  function choose(next: ShareSelection) {
    if (!canEdit()) return
    setSelection(next)
    setExported("")
    setStatus(undefined)
  }

  function chooseProvider(id: string, checked: boolean) {
    const selected = selection()
    const available = inventory()
    choose({
      ...selected,
      providers: toggle(selected.providers, id, checked),
      provider_base_urls: checked ? selected.provider_base_urls : selected.provider_base_urls.filter((item) => item !== id),
      provider_api_keys: checked ? selected.provider_api_keys : selected.provider_api_keys.filter((item) => item !== id),
      scenarios: checked ? selected.scenarios : selected.scenarios.filter((name) => available?.scenarios.find((item) => item.name === name)?.provider !== id),
      subagent_models: checked ? selected.subagent_models : selected.subagent_models.filter((name) => available?.subagent_models.find((item) => item.name === name)?.provider !== id),
    })
  }

  function selectEnv(name: string, checked: boolean) {
    const selected = selection()
    const env: ShareSelection["env"] = Object.assign(Object.create(null), selected.env)
    if (checked) env[name] = false
    else delete env[name]
    choose({ ...selected, env })
  }

  function allowSecrets(checked: boolean) {
    if (!canEdit()) return
    setIncludeSecrets(checked)
    setExported("")
    if (checked) return
    setExportPassphrase("")
    const selected = selection()
    setSelection({ ...selected, provider_api_keys: [], env: Object.fromEntries(Object.keys(selected.env).map((name) => [name, false])) })
  }

  function editExportPassphrase(value: string) {
    if (!canEdit()) return
    setExportPassphrase(value)
    setExported("")
  }

  function editImportInput(field: "share" | "passphrase", value: string) {
    if (!canEdit()) return
    invalidatePreview()
    if (field === "share") setShareString(value)
    else setImportPassphrase(value)
  }

  function updateChoice(row: PreviewRow, choice: ShareChoice) {
    if (!canEdit()) return
    setReviewed(false)
    setDecisions((current) => ({ ...current, [row.group]: { ...current[row.group], [row.id]: choice } }))
  }

  function review(checked: boolean) {
    if (canEdit()) setReviewed(checked)
  }

  async function exportSelection() {
    if (!canEdit() || !canExport() || !start("export")) return
    const epoch = generation
    request = new AbortController()
    try {
      const value = await configShareService.export(selection(), includeSecrets(), exportPassphrase() || undefined, request.signal)
      if (current(epoch)) {
        setExported(value)
        setExportPassphrase("")
      }
    } catch {
      if (current(epoch)) setError(text("share_export_failed"))
    } finally { finish(epoch) }
  }

  async function previewInput() {
    if (!canEdit() || !shareString().trim() || !start("preview")) return
    const epoch = generation
    request = new AbortController()
    clearPreview()
    try {
      const value = await configShareService.preview({
        share_string: shareString(), ...(importPassphrase() ? { passphrase: importPassphrase() } : {}),
      }, request.signal)
      if (current(epoch)) {
        const initial = emptyShareDecisions()
        for (const row of rowsFor(value)) {
          if (row.conflict || row.provider?.replace_allowed === false) {
            (initial[row.group] as Record<string, ShareChoice>)[row.id] = { action: "skip" }
          }
        }
        setPreview(value)
        setDecisions(initial)
      }
    } catch {
      if (current(epoch)) setError(text("share_preview_failed"))
    } finally { finish(epoch) }
  }

  async function refreshSavedState(value: ShareOperation, epoch: number) {
    try {
      await reloadClientAuthority(value.revisions)
      if (current(epoch)) {
        setRefreshRequired(false)
        setError(undefined)
        setStatus(text("share_saved"))
      }
    } catch {
      if (current(epoch)) {
        setRefreshRequired(true)
        setStatus(text("share_saved"))
        setError(text("share_saved_refresh_failed"))
      }
    }
  }

  async function recoverRejectedState(revisions: ShareRevisions, epoch: number, message: string) {
    try {
      await reloadClientAuthority(revisions)
      if (current(epoch)) {
        setRecovery(undefined)
        setStatus(undefined)
        setError(message)
      }
    } catch {
      if (current(epoch)) {
        setRecovery({ revisions, error: message })
        setStatus(undefined)
        setError(text("share_current_refresh_failed"))
      }
    }
  }

  async function showOperation(value: ShareOperation, epoch: number, expected: ShareRevisions) {
    if (current(epoch)) {
      setReceipt(value)
      if (value.state === "committed") {
        setPending(undefined)
        clearPreview()
        setStatus(text("share_saved"))
        setRefreshRequired(true)
      } else if (value.state === "rejected") {
        setPending(undefined)
        clearPreview()
        setError(text("share_apply_rejected"))
      } else {
        setError(text("share_apply_unconfirmed"))
      }
    }
    // The operation survives leaving the tab. Refresh global authority even
    // when there is no longer a mounted settings component to show the result.
    if (value.state === "committed") await refreshSavedState(value, epoch)
    else if (value.state === "rejected") await recoverRejectedState(expected, epoch, text("share_apply_rejected"))
  }

  async function apply() {
    const snapshot = preview()
    if (!snapshot || !canEdit() || !canApply()) return
    let id: string
    try { id = crypto.randomUUID() } catch {
      setError(text("share_apply_rejected"))
      return
    }
    if (!start("apply")) return
    const epoch = generation
    const expected = snapshot.expected_revisions
    try {
      let applied: Promise<ShareOperation>
      {
        const passphrase = importPassphrase()
        const value = {
          share_string: shareString(), ...(passphrase ? { passphrase } : {}),
          choices: decisions(), expected_revisions: expected, preview_token: snapshot.preview_token, operation_id: id,
        }
        setPending({ id, expected })
        revokeClientAuthority()
        setShareString("")
        setImportPassphrase("")
        setExportPassphrase("")
        applied = configShareService.apply(value)
      }
      await showOperation(await applied, epoch, expected)
    } catch (failure) {
      if (failure instanceof ConfigShareError && (failure.kind === "stale" || failure.kind === "invalid")) {
        const message = text(failure.kind === "stale" ? "share_stale" : "share_apply_rejected")
        if (current(epoch)) {
          setPending(undefined)
          clearPreview()
          setError(message)
        }
        await recoverRejectedState(expected, epoch, message)
      } else if (current(epoch)) setError(text("share_apply_unconfirmed"))
    } finally { finish(epoch) }
  }

  async function checkOperation() {
    const operation = pending()
    if (!operation || !start("check")) return
    const epoch = generation
    try {
      await showOperation(await configShareService.operation(operation.id), epoch, operation.expected)
    } catch {
      if (current(epoch)) setError(text("share_apply_unconfirmed"))
    } finally { finish(epoch) }
  }

  async function retryRefresh() {
    const rejected = recovery()
    const saved = receipt()
    if (!rejected && (saved?.state !== "committed" || !refreshRequired())) return
    if (!start("refresh")) return
    const epoch = generation
    try {
      if (rejected) await recoverRejectedState(rejected.revisions, epoch, rejected.error)
      else if (saved) await refreshSavedState(saved, epoch)
    } finally { finish(epoch) }
  }

  async function copy() {
    if (!exported() || !start("copy")) return
    const epoch = generation
    try {
      await navigator.clipboard.writeText(exported())
      if (current(epoch)) setStatus(text("share_copied"))
    } catch {
      if (current(epoch)) setError(text("share_copy_failed"))
    } finally { finish(epoch) }
  }

  return {
    text, inventory, loading, selection, includeSecrets, exportPassphrase, exported, shareString, importPassphrase,
    preview, rows, choiceFor, reviewed, receipt, pending, refreshRequired, recovery, error, status, busy, locked,
    canExport, canApply, canCancel, cancel, choose, chooseProvider, selectEnv, allowSecrets, editExportPassphrase,
    editImportInput, updateChoice, review, exportSelection, previewInput, apply, checkOperation, retryRefresh, copy,
  }
}

export { toggle, type PreviewRow }
