import { useEffect, useId, useRef, useState } from "react"
import { configShareService, ConfigShareError } from "@services/config/ConfigShareService"
import {
  emptyShareDecisions, emptyShareSelection, MAX_SHARE_PASSPHRASE_BYTES, MAX_SHARE_STRING_BYTES, MIN_SHARE_PASSPHRASE_BYTES,
  type ShareApplyRequest, type ShareChoice, type ShareDecisions, type ShareInventory,
  type ShareOperation, type SharePreviewResponse, type ShareSelection,
} from "@shared/types/configShare"
import { uiText, useUiLocale } from "@shared/i18n/ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const emptyInventory = (): ShareInventory => ({ providers: [], scenarios: [], subagent_models: [], env: [] })
type Group = keyof ShareDecisions
interface PreviewRow { group: Group; id: string; label: string; conflict: boolean; secret: boolean }
const rowsFor = ({ preview: p }: SharePreviewResponse): PreviewRow[] => [
  ...p.providers.map((row) => ({ group: "providers" as const, id: row.id, label: row.label ? `${row.label} (${row.id})` : row.id, conflict: row.conflict, secret: row.has_api_key })),
  ...p.scenarios.map((row) => ({ group: "scenarios" as const, id: row.scenario, label: `${row.scenario}: ${row.provider} / ${row.model}`, conflict: row.conflict, secret: false })),
  ...p.subagent_models.map((row) => ({ group: "subagent_models" as const, id: row.name, label: `${row.name}: ${row.provider} / ${row.model}`, conflict: row.conflict, secret: false })),
  ...p.env.map((row) => ({ group: "env" as const, id: row.name, label: row.name, conflict: row.conflict, secret: row.has_value })),
]
const toggle = (values: string[], value: string, checked: boolean) =>
  checked ? [...new Set([...values, value])] : values.filter((item) => item !== value)
const checkedRows = (preview: SharePreviewResponse): ShareDecisions => {
  const decisions = emptyShareDecisions()
  for (const row of rowsFor(preview)) {
    if (row.conflict) (decisions[row.group] as Record<string, ShareChoice>)[row.id] = { action: "skip" }
  }
  return decisions
}
const rowChoice = (decisions: ShareDecisions, row: PreviewRow): ShareChoice | undefined =>
  Object.hasOwn(decisions[row.group], row.id) ? (decisions[row.group] as Record<string, ShareChoice>)[row.id] : undefined
function Check({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />{label}</label>
}

export function SettingsConfigShare() {
  useUiLocale()
  const id = useId()
  const [inventory, setInventory] = useState<ShareInventory>(emptyInventory)
  const [loading, setLoading] = useState(true)
  const [confirmed, setConfirmed] = useState(false)
  const [selection, setSelection] = useState<ShareSelection>(emptyShareSelection)
  const [includeSecrets, setIncludeSecrets] = useState(false)
  const [exportPassphrase, setExportPassphrase] = useState("")
  const [exported, setExported] = useState("")
  const [shareString, setShareString] = useState("")
  const [importPassphrase, setImportPassphrase] = useState("")
  const [preview, setPreview] = useState<SharePreviewResponse | null>(null)
  const [decisions, setDecisions] = useState<ShareDecisions>(emptyShareDecisions)
  const [reviewed, setReviewed] = useState(false)
  const [operation, setOperation] = useState<ShareOperation | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState<"export" | "preview" | "apply" | "check" | "copy" | null>(null)
  const busyRef = useRef<typeof busy>(null)
  const generation = useRef(0)
  const request = useRef<AbortController | null>(null)
  const pendingOperationId = useRef<string | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    void configShareService.inventory().then((value) => {
      if (mounted.current) { setInventory(value); setConfirmed(true) }
    }).catch(() => {
      if (mounted.current) setError(uiText("share_inventory_failed"))
    }).finally(() => { if (mounted.current) setLoading(false) })
    return () => {
      mounted.current = false
      generation.current += 1
      request.current?.abort()
      pendingOperationId.current = null
    }
  }, [])

  const invalidate = () => {
    generation.current += 1
    setPreview(null); setDecisions(emptyShareDecisions()); setReviewed(false)
    setOperation(null); pendingOperationId.current = null
    setStatus(null); setError(null)
  }
  const cancel = () => {
    if (busyRef.current === "apply" || busyRef.current === "check" || pendingOperationId.current) return
    request.current?.abort(); request.current = null
    busyRef.current = null; setBusy(null)
    invalidate(); setShareString(""); setImportPassphrase("")
    setExportPassphrase(""); setExported(""); setIncludeSecrets(false)
    setSelection(emptyShareSelection())
  }
  const start = (phase: NonNullable<typeof busy>) => {
    if (busyRef.current) return false
    busyRef.current = phase; setBusy(phase); setError(null); setStatus(null)
    return true
  }
  const finish = (epoch: number) => {
    if (mounted.current && epoch === generation.current) { busyRef.current = null; setBusy(null); request.current = null }
  }
  const choose = (next: ShareSelection) => { if (!busyRef.current) { setSelection(next); setExported(""); setStatus(null) } }
  const chooseProvider = (provider: string, checked: boolean) => choose({
    ...selection,
    providers: toggle(selection.providers, provider, checked),
    provider_base_urls: checked ? selection.provider_base_urls : selection.provider_base_urls.filter((item) => item !== provider),
    provider_api_keys: checked ? selection.provider_api_keys : selection.provider_api_keys.filter((item) => item !== provider),
    scenarios: checked ? selection.scenarios : selection.scenarios.filter((name) => inventory.scenarios.find((item) => item.name === name)?.provider !== provider),
    subagent_models: checked ? selection.subagent_models : selection.subagent_models.filter((name) => inventory.subagent_models.find((item) => item.name === name)?.provider !== provider),
  })
  const sensitiveSelection = selection.provider_api_keys.length > 0 || Object.values(selection.env).some(Boolean)
  const hasSelection = selection.providers.length + selection.scenarios.length + selection.subagent_models.length + Object.keys(selection.env).length > 0
  const locked = !!busy || !!pendingOperationId.current
  const validExportPassphrase = !sensitiveSelection || (!!exportPassphrase.trim() && new TextEncoder().encode(exportPassphrase).length >= MIN_SHARE_PASSPHRASE_BYTES && new TextEncoder().encode(exportPassphrase).length <= MAX_SHARE_PASSPHRASE_BYTES)

  const exportSelection = async () => {
    if (!confirmed || !hasSelection || !validExportPassphrase || !start("export")) return
    const epoch = generation.current
    request.current = new AbortController()
    try {
      const result = await configShareService.export(selection, includeSecrets, exportPassphrase || undefined, request.current.signal)
      if (mounted.current && epoch === generation.current) { setExported(result); setExportPassphrase("") }
    } catch {
      if (mounted.current && epoch === generation.current) setError(uiText("share_export_failed"))
    } finally { finish(epoch) }
  }
  const previewInput = async () => {
    if (!shareString.trim() || pendingOperationId.current || !start("preview")) return
    const epoch = generation.current
    request.current = new AbortController()
    setPreview(null); setReviewed(false)
    try {
      const value = await configShareService.preview({ share_string: shareString, ...(importPassphrase ? { passphrase: importPassphrase } : {}) }, request.current.signal)
      if (mounted.current && epoch === generation.current) { setPreview(value); setDecisions(checkedRows(value)) }
    } catch {
      if (mounted.current && epoch === generation.current) setError(uiText("share_preview_failed"))
    } finally { finish(epoch) }
  }
  const showOperation = (value: ShareOperation) => {
    setOperation(value)
    if (value.state === "committed") {
      pendingOperationId.current = null
      setShareString(""); setImportPassphrase(""); setPreview(null); setDecisions(emptyShareDecisions()); setReviewed(false)
      setStatus(uiText("share_saved"))
    } else if (value.state === "rejected") {
      pendingOperationId.current = null; setPreview(null); setReviewed(false); setError(uiText("share_apply_rejected"))
    } else setError(uiText("share_apply_unconfirmed"))
  }
  const invalidRename = preview && rowsFor(preview).some((row) => {
    const choice = rowChoice(decisions, row)
    return choice?.action === "rename" && (!choice.target.trim() || choice.target === row.id)
  })
  const apply = async () => {
    if (!preview || preview.apply_blocked || !reviewed || invalidRename || pendingOperationId.current || busyRef.current) return
    let operationId: string
    try { operationId = crypto.randomUUID() } catch { setError(uiText("share_apply_rejected")); return }
    if (!start("apply")) return
    const epoch = generation.current
    const value: ShareApplyRequest = {
      share_string: shareString, ...(importPassphrase ? { passphrase: importPassphrase } : {}),
      choices: decisions, expected_revisions: preview.expected_revisions, preview_token: preview.preview_token,
      operation_id: operationId,
    }
    pendingOperationId.current = operationId
    setShareString(""); setImportPassphrase(""); setExportPassphrase("")
    try {
      const result = await configShareService.apply(value)
      if (mounted.current && epoch === generation.current) showOperation(result)
    } catch (failure) {
      if (mounted.current && epoch === generation.current) {
        if (failure instanceof ConfigShareError && ["stale", "invalid"].includes(failure.kind)) {
          pendingOperationId.current = null; setPreview(null); setReviewed(false)
          setError(uiText(failure.kind === "stale" ? "share_stale" : "share_apply_rejected"))
        } else setError(uiText("share_apply_unconfirmed"))
      }
    } finally { finish(epoch) }
  }
  const checkOperation = async () => {
    const pending = pendingOperationId.current
    if (!pending || !start("check")) return
    const epoch = generation.current
    try {
      const result = await configShareService.operation(pending)
      if (mounted.current && epoch === generation.current) showOperation(result)
    } catch {
      if (mounted.current && epoch === generation.current) setError(uiText("share_apply_unconfirmed"))
    } finally { finish(epoch) }
  }
  const copy = async () => {
    if (!exported || !start("copy")) return
    const epoch = generation.current
    try {
      await navigator.clipboard.writeText(exported)
      if (mounted.current && epoch === generation.current) setStatus(uiText("share_copied"))
    } catch {
      if (mounted.current && epoch === generation.current) setError(uiText("share_copy_failed"))
    } finally { finish(epoch) }
  }

  return <div className="space-y-6">
    <p className="text-sm text-muted-foreground">{uiText("share_description")}</p>
    <section className="space-y-3 rounded-lg border p-3" aria-labelledby={`${id}-export`}>
      <h3 id={`${id}-export`} className="font-medium">{uiText("share_export_title")}</h3>
      <p className="text-xs text-muted-foreground">{uiText("share_selection_hint")}</p>
      <p className="text-xs text-muted-foreground">{uiText("share_contract_limits")}</p>
      {loading ? <p>{uiText("share_loading")}</p> : <>
        <fieldset disabled={locked || !confirmed} className="space-y-3">
          <legend className="mb-2 text-sm font-medium">{uiText("share_providers")}</legend>
          {inventory.providers.map((provider) => <div key={provider.id} className="space-y-2 rounded border p-2">
            <Check label={`${provider.label} (${provider.id})`} checked={selection.providers.includes(provider.id)} onChange={(checked) => chooseProvider(provider.id, checked)} />
            <div className="ml-5 flex flex-wrap gap-4">
              <Check label={uiText("share_include_base_url")} checked={selection.provider_base_urls.includes(provider.id)} disabled={!selection.providers.includes(provider.id)} onChange={(checked) => choose({ ...selection, provider_base_urls: toggle(selection.provider_base_urls, provider.id, checked) })} />
              <Check label={uiText("share_include_api_key")} checked={selection.provider_api_keys.includes(provider.id)} disabled={!selection.providers.includes(provider.id) || !includeSecrets || provider.type === "copilot"} onChange={(checked) => choose({ ...selection, provider_api_keys: toggle(selection.provider_api_keys, provider.id, checked) })} />
            </div>
          </div>)}
        </fieldset>
        <fieldset disabled={locked || !confirmed} className="space-y-2">
          <legend className="mb-2 text-sm font-medium">{uiText("share_scenarios")}</legend>
          {inventory.scenarios.map((item) => <Check key={item.name} label={`${item.name}: ${item.provider} / ${item.model}`} checked={selection.scenarios.includes(item.name)} onChange={(checked) => choose({ ...selection, scenarios: toggle(selection.scenarios, item.name, checked) as ShareSelection["scenarios"], providers: checked ? toggle(selection.providers, item.provider, true) : selection.providers })} />)}
          {inventory.subagent_models.map((item) => <Check key={item.name} label={`${uiText("share_subagent")}: ${item.name} / ${item.model}`} checked={selection.subagent_models.includes(item.name)} onChange={(checked) => choose({ ...selection, subagent_models: toggle(selection.subagent_models, item.name, checked), providers: checked ? toggle(selection.providers, item.provider, true) : selection.providers })} />)}
        </fieldset>
        <fieldset disabled={locked || !confirmed} className="space-y-2">
          <legend className="mb-2 text-sm font-medium">{uiText("share_env")}</legend>
          {inventory.env.map((entry) => <div key={entry.name} className="flex flex-wrap items-center gap-4 rounded border p-2">
            <Check label={entry.name} checked={Object.hasOwn(selection.env, entry.name)} onChange={(checked) => { const env = Object.assign(Object.create(null), selection.env); if (checked) env[entry.name] = false; else delete env[entry.name]; choose({ ...selection, env }) }} />
            <Check label={uiText("share_include_value")} checked={!!selection.env[entry.name]} disabled={!Object.hasOwn(selection.env, entry.name) || !entry.has_value || !includeSecrets} onChange={(checked) => choose({ ...selection, env: { ...selection.env, [entry.name]: checked } })} />
          </div>)}
        </fieldset>
      </>}
      <Check label={uiText("share_sensitive_choice")} checked={includeSecrets} disabled={locked} onChange={(checked) => {
        setIncludeSecrets(checked); setExported("")
        if (!checked) { setExportPassphrase(""); setSelection({ ...selection, provider_api_keys: [], env: Object.fromEntries(Object.keys(selection.env).map((name) => [name, false])) }) }
      }} />
      {includeSecrets && <p className="text-xs text-destructive">{uiText("share_sensitive_warning")}</p>}
      <label htmlFor={`${id}-export-password`} className="block text-sm">{uiText("share_export_passphrase")}</label>
      <Input id={`${id}-export-password`} type="password" autoComplete="new-password" maxLength={MAX_SHARE_PASSPHRASE_BYTES} value={exportPassphrase} disabled={locked} onChange={(event) => { setExportPassphrase(event.target.value); setExported("") }} />
      <Button type="button" onClick={() => void exportSelection()} disabled={locked || !confirmed || !hasSelection || !validExportPassphrase}>{busy === "export" ? uiText("share_working") : uiText("share_generate")}</Button>
      {exported && <div className="space-y-2">
        <label htmlFor={`${id}-output`} className="block text-sm">{uiText("share_output")}</label>
        <textarea id={`${id}-output`} className="w-full rounded border bg-background p-2 font-mono text-xs" readOnly value={exported} rows={3} spellCheck={false} />
        <Button type="button" variant="outline" disabled={!!busy} onClick={() => void copy()}>{uiText("share_copy")}</Button>
      </div>}
    </section>
    <section className="space-y-3 rounded-lg border p-3" aria-labelledby={`${id}-import`}>
      <h3 id={`${id}-import`} className="font-medium">{uiText("share_import_title")}</h3>
      <label htmlFor={`${id}-input`} className="block text-sm">{uiText("share_paste")}</label>
      <textarea id={`${id}-input`} className="w-full rounded border bg-background p-2 font-mono text-xs" rows={4} maxLength={MAX_SHARE_STRING_BYTES} autoComplete="off" spellCheck={false} value={shareString} disabled={locked} onChange={(event) => { if (!busyRef.current && !pendingOperationId.current) { invalidate(); setShareString(event.target.value) } }} />
      <label htmlFor={`${id}-import-password`} className="block text-sm">{uiText("share_import_passphrase")}</label>
      <Input id={`${id}-import-password`} type="password" autoComplete="off" maxLength={MAX_SHARE_PASSPHRASE_BYTES} value={importPassphrase} disabled={locked} onChange={(event) => { if (!busyRef.current && !pendingOperationId.current) { invalidate(); setImportPassphrase(event.target.value) } }} />
      <Button type="button" variant="outline" disabled={locked || !shareString.trim()} onClick={() => void previewInput()}>{busy === "preview" ? uiText("share_working") : uiText("share_preview")}</Button>
      {preview && <div className="space-y-3" role="region" aria-label={uiText("share_preview")}>
        <p className="text-xs text-muted-foreground">{uiText("share_redacted_hint")}</p>
        {preview.apply_blocked && <p role="alert" className="text-xs text-destructive">{uiText("share_boundary_blocked")}</p>}
        {preview.warnings?.includes("automatic_provider_authentication_blocked") && <p className="text-xs text-destructive">{uiText("share_provider_auth_blocked")}</p>}
        {preview.warnings?.includes("credential_key_uninitialized") && <p className="text-xs text-destructive">{uiText("share_key_uninitialized")}</p>}
        {preview.preview.contains_secrets && <p className="text-xs text-destructive">{uiText("share_contains_secrets")}</p>}
        {rowsFor(preview).map((row) => {
          const choice = rowChoice(decisions, row) ?? { action: "replace" }
          const updateChoice = (next: ShareChoice) => { if (!busyRef.current && !pendingOperationId.current) { setReviewed(false); setDecisions({ ...decisions, [row.group]: { ...decisions[row.group], [row.id]: next } }) } }
          return <div key={`${row.group}:${row.id}`} className="space-y-2 rounded border p-2">
            <div className="text-sm break-words">{row.label}{row.conflict ? ` · ${uiText("share_conflict")}` : ` · ${uiText("share_addition")}`}{row.secret ? ` · ${uiText("share_hidden_value")}` : ""}</div>
            <label className="flex items-center gap-2 text-xs">{uiText("share_action")}
              <select aria-label={`${uiText("share_action")} ${row.group}:${row.id}`} className="settings-select" value={choice.action} disabled={locked} onChange={(event) => updateChoice(event.target.value === "rename" ? { action: "rename", target: "" } : { action: event.target.value as "skip" | "replace" })}>
                <option value="skip">{uiText("share_skip")}</option>
                <option value="replace">{row.conflict ? uiText("share_replace") : uiText("share_import_item")}</option>
                {row.group !== "scenarios" && <option value="rename">{uiText("share_rename")}</option>}
              </select>
            </label>
            {choice.action === "rename" && <Input aria-label={`${uiText("share_new_name")} ${row.group}:${row.id}`} value={choice.target} disabled={locked} maxLength={128} onChange={(event) => updateChoice({ action: "rename", target: event.target.value })} />}
          </div>
        })}
        <p className="text-xs text-muted-foreground">{uiText("share_reference_hint")}</p>
        <Check label={uiText("share_review_confirm")} checked={reviewed} disabled={locked} onChange={setReviewed} />
        <Button type="button" disabled={locked || preview.apply_blocked || !reviewed || !!invalidRename} onClick={() => void apply()}>{busy === "apply" ? uiText("share_working") : uiText("share_apply")}</Button>
      </div>}
      {pendingOperationId.current && <Button type="button" variant="outline" disabled={!!busy} onClick={() => void checkOperation()}>{uiText("share_check_result")}</Button>}
      {pendingOperationId.current && <p className="break-all text-xs text-muted-foreground">{uiText("share_receipt", { id: pendingOperationId.current })}</p>}
      {operation?.state === "committed" && <p className="text-xs text-muted-foreground">{uiText("share_receipt", { id: operation.operation_id })}</p>}
    </section>
    <Button type="button" variant="ghost" onClick={cancel} disabled={busy === "apply" || busy === "check" || !!pendingOperationId.current}>{uiText("share_cancel")}</Button>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {status && <p role="status" className="text-sm">{status}</p>}
  </div>
}
