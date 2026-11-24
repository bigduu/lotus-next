import { createUniqueId, For, Show } from "solid-js"
import { MAX_SHARE_PASSPHRASE_BYTES, MAX_SHARE_STRING_BYTES } from "@shared/types/configShare"
import { Button } from "../../ui/button"
import { Input } from "../../ui/input"
import { createConfigShare, toggle, type PreviewRow } from "./createConfigShare"

type ConfigShare = ReturnType<typeof createConfigShare>

function Check(props: { label: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return <label class="flex items-center gap-2 text-sm">
    <input type="checkbox" checked={props.checked} disabled={props.disabled}
      onChange={(event) => props.onChange(event.currentTarget.checked)} />
    {props.label}
  </label>
}

function ExportSettings(props: { id: string; share: ConfigShare }) {
  const { share, id } = props
  const { text, inventory, selection, locked, includeSecrets, choose } = share
  return <section class="space-y-3 rounded-lg border p-3" aria-labelledby={`${id}-export`}>
    <h3 id={`${id}-export`} class="font-medium">{text("share_export_title")}</h3>
    <p class="text-xs text-muted-foreground">{text("share_selection_hint")}</p>
    <p class="text-xs text-muted-foreground">{text("share_contract_limits")}</p>
    <Show when={!share.loading()} fallback={<p>{text("share_loading")}</p>}>
      <fieldset disabled={locked() || !inventory()} class="space-y-3">
        <legend class="mb-2 text-sm font-medium">{text("share_providers")}</legend>
        <For each={inventory()?.providers}>{(provider) => <div class="space-y-2 rounded border p-2">
          <Check label={`${provider.label} (${provider.id})`} checked={selection().providers.includes(provider.id)}
            onChange={(checked) => share.chooseProvider(provider.id, checked)} />
          <div class="ml-5 flex flex-wrap gap-4">
            <Check label={text("share_include_base_url")} checked={selection().provider_base_urls.includes(provider.id)}
              disabled={!selection().providers.includes(provider.id)}
              onChange={(checked) => choose({ ...selection(), provider_base_urls: toggle(selection().provider_base_urls, provider.id, checked) })} />
            <Check label={text("share_include_api_key")} checked={selection().provider_api_keys.includes(provider.id)}
              disabled={!selection().providers.includes(provider.id) || !includeSecrets()}
              onChange={(checked) => choose({ ...selection(), provider_api_keys: toggle(selection().provider_api_keys, provider.id, checked) })} />
          </div>
        </div>}</For>
      </fieldset>
      <fieldset disabled={locked() || !inventory()} class="space-y-2">
        <legend class="mb-2 text-sm font-medium">{text("share_scenarios")}</legend>
        <For each={inventory()?.scenarios}>{(item) =>
          <Check label={`${item.name}: ${item.provider} / ${item.model}`} checked={selection().scenarios.includes(item.name)}
            onChange={(checked) => choose({
              ...selection(), scenarios: toggle(selection().scenarios, item.name, checked),
              providers: checked ? toggle(selection().providers, item.provider, true) : selection().providers,
            })} />
        }</For>
        <For each={inventory()?.subagent_models}>{(item) =>
          <Check label={`${text("share_subagent")}: ${item.name} / ${item.model}`} checked={selection().subagent_models.includes(item.name)}
            onChange={(checked) => choose({
              ...selection(), subagent_models: toggle(selection().subagent_models, item.name, checked),
              providers: checked ? toggle(selection().providers, item.provider, true) : selection().providers,
            })} />
        }</For>
      </fieldset>
      <fieldset disabled={locked() || !inventory()} class="space-y-2">
        <legend class="mb-2 text-sm font-medium">{text("share_env")}</legend>
        <For each={inventory()?.env}>{(entry) => <div class="flex flex-wrap items-center gap-4 rounded border p-2">
          <Check label={entry.name} checked={Object.hasOwn(selection().env, entry.name)}
            onChange={(checked) => share.selectEnv(entry.name, checked)} />
          <Check label={text("share_include_value")} checked={Object.hasOwn(selection().env, entry.name) && selection().env[entry.name]}
            disabled={!Object.hasOwn(selection().env, entry.name) || !entry.has_value || !includeSecrets()}
            onChange={(checked) => choose({ ...selection(), env: { ...selection().env, [entry.name]: checked } })} />
        </div>}</For>
      </fieldset>
    </Show>
    <Check label={text("share_sensitive_choice")} checked={includeSecrets()} disabled={locked()} onChange={share.allowSecrets} />
    <Show when={includeSecrets()}><p class="text-xs text-destructive">{text("share_sensitive_warning")}</p></Show>
    <label for={`${id}-export-password`} class="block text-sm">{text("share_export_passphrase")}</label>
    <Input id={`${id}-export-password`} type="password" autocomplete="new-password" maxlength={MAX_SHARE_PASSPHRASE_BYTES}
      value={share.exportPassphrase()} disabled={locked()} onInput={(event) => share.editExportPassphrase(event.currentTarget.value)} />
    <Button type="button" disabled={locked() || !share.canExport()} onClick={() => void share.exportSelection()}>
      {text(share.busy() === "export" ? "share_working" : "share_generate")}
    </Button>
    <Show when={share.exported()}>
      <div class="space-y-2">
        <label for={`${id}-output`} class="block text-sm">{text("share_output")}</label>
        <textarea id={`${id}-output`} class="w-full rounded border bg-background p-2 font-mono text-xs"
          readonly value={share.exported()} rows={3} spellcheck={false} />
        <Button type="button" variant="outline" disabled={!!share.busy()} onClick={() => void share.copy()}>
          {text("share_copy")}
        </Button>
      </div>
    </Show>
  </section>
}

function PreviewEntry(props: { row: PreviewRow; share: ConfigShare }) {
  const { row, share } = props
  const { text, locked } = share
  const choice = () => share.choiceFor(row)
  const target = () => {
    const current = choice()
    return current.action === "rename" ? current.target : ""
  }
  const entryKey = `${row.group}:${row.id}`
  const canRename = row.group !== "scenarios" && row.provider?.rename_allowed !== false
  return <div class="space-y-2 rounded border p-2">
    <div class="text-sm break-words">
      {row.label}{` · ${text(row.conflict ? "share_conflict" : "share_addition")}`}{row.secret ? ` · ${text("share_hidden_value")}` : ""}
    </div>
    <Show when={row.provider} keyed>{(provider) => <dl class="space-y-1 text-xs text-muted-foreground">
      <div><dt class="inline">{text("share_imported_provider_type")}: </dt><dd class="inline break-all font-mono">{provider.provider_type}</dd></div>
      <div>
        <dt class="inline">{text("share_imported_origin")}: </dt>
        <dd class="inline break-all font-mono">
          {provider.source_origin ?? text(choice().action === "rename" || !row.conflict ? "share_origin_provider_default" : "share_origin_keep_current")}
        </dd>
      </div>
      <div>
        <dt class="inline">{text("share_current_origin")}: </dt>
        <dd class="inline break-all font-mono">{provider.target_origin ?? text("share_origin_unknown")}</dd>
      </div>
    </dl>}</Show>
    <Show when={row.provider?.rename_allowed === false || row.provider?.replace_allowed === false}>
      <p class="text-xs text-muted-foreground">{text(row.provider?.rename_allowed === false
        ? "share_existing_bodhi_only"
        : row.provider?.retired_id ? "share_retired_provider_id" : "share_provider_type_mismatch")}</p>
    </Show>
    <label class="flex items-center gap-2 text-xs">{text("share_action")}
      <select aria-label={`${text("share_action")} ${entryKey}`} class="settings-select" value={choice().action} disabled={locked()}
        onChange={(event) => {
          const action = event.currentTarget.value
          if (action === "rename") share.updateChoice(row, { action, target: "" })
          else if (action === "skip" || action === "replace") share.updateChoice(row, { action })
        }}>
        <option value="skip">{text("share_skip")}</option>
        <option value="replace" disabled={row.provider?.replace_allowed === false}>
          {text(row.conflict ? "share_replace" : "share_import_item")}
        </option>
        <Show when={canRename}><option value="rename">{text("share_rename")}</option></Show>
      </select>
    </label>
    <Show when={row.provider?.replace_allowed && row.provider.credential_origin_risk && choice().action === "replace"}>
      <p role="alert" class="break-words text-xs text-destructive">
        {text("share_retained_key_origin_warning", { origin: row.provider?.source_origin })}
      </p>
    </Show>
    <Show when={choice().action === "rename"}>
      <Input aria-label={`${text("share_new_name")} ${entryKey}`} value={target()} disabled={locked()} maxlength={128}
        onInput={(event) => share.updateChoice(row, { action: "rename", target: event.currentTarget.value })} />
    </Show>
  </div>
}

function ImportSettings(props: { id: string; share: ConfigShare }) {
  const { id, share } = props
  const { text, locked, busy, pending, receipt } = share
  return <section class="space-y-3 rounded-lg border p-3" aria-labelledby={`${id}-import`}>
    <h3 id={`${id}-import`} class="font-medium">{text("share_import_title")}</h3>
    <label for={`${id}-input`} class="block text-sm">{text("share_paste")}</label>
    <textarea id={`${id}-input`} class="w-full rounded border bg-background p-2 font-mono text-xs" rows={4}
      maxlength={MAX_SHARE_STRING_BYTES} autocomplete="off" spellcheck={false} value={share.shareString()} disabled={locked()}
      onInput={(event) => share.editImportInput("share", event.currentTarget.value)} />
    <label for={`${id}-import-password`} class="block text-sm">{text("share_import_passphrase")}</label>
    <Input id={`${id}-import-password`} type="password" autocomplete="off" maxlength={MAX_SHARE_PASSPHRASE_BYTES}
      value={share.importPassphrase()} disabled={locked()} onInput={(event) => share.editImportInput("passphrase", event.currentTarget.value)} />
    <Button type="button" variant="outline" disabled={locked() || !share.shareString().trim()} onClick={() => void share.previewInput()}>
      {text(busy() === "preview" ? "share_working" : "share_preview")}
    </Button>
    <Show when={share.preview()} keyed>{(preview) => <div class="space-y-3" role="region" aria-label={text("share_preview")}>
      <p class="text-xs text-muted-foreground">{text("share_redacted_hint")}</p>
      <Show when={preview.apply_blocked}><p role="alert" class="text-xs text-destructive">{text("share_boundary_blocked")}</p></Show>
      <Show when={preview.warnings?.includes("automatic_provider_authentication_blocked")}>
        <p class="text-xs text-destructive">{text("share_provider_auth_blocked")}</p>
      </Show>
      <Show when={preview.warnings?.includes("credential_key_uninitialized")}>
        <p class="text-xs text-destructive">{text("share_key_uninitialized")}</p>
      </Show>
      <Show when={preview.preview.contains_secrets}><p class="text-xs text-destructive">{text("share_contains_secrets")}</p></Show>
      <For each={share.rows()}>{(row) => <PreviewEntry row={row} share={share} />}</For>
      <p class="text-xs text-muted-foreground">{text("share_reference_hint")}</p>
      <Check label={text("share_review_confirm")} checked={share.reviewed()} disabled={locked()} onChange={share.review} />
      <Button type="button" disabled={locked() || !share.canApply()} onClick={() => void share.apply()}>
        {text(busy() === "apply" ? "share_working" : "share_apply")}
      </Button>
    </div>}</Show>
    <Show when={pending()} keyed>{(operation) => <>
      <Button type="button" variant="outline" disabled={!!busy()} onClick={() => void share.checkOperation()}>
        {text("share_check_result")}
      </Button>
      <p class="break-all text-xs text-muted-foreground">{text("share_receipt", { id: operation.id })}</p>
    </>}</Show>
    <Show when={receipt()?.state === "committed" ? receipt() : undefined} keyed>{(operation) => <>
      <p class="break-all text-xs text-muted-foreground">{text("share_receipt", { id: operation.operation_id })}</p>
      <Show when={share.refreshRequired()}>
        <Button type="button" variant="outline" disabled={!!busy()} onClick={() => void share.retryRefresh()}>
          {text("share_refresh_saved")}
        </Button>
      </Show>
    </>}</Show>
    <Show when={share.recovery()}>
      <Button type="button" variant="outline" disabled={!!busy()} onClick={() => void share.retryRefresh()}>
        {text("share_refresh_current")}
      </Button>
    </Show>
  </section>
}

export function SettingsConfigShare() {
  const id = createUniqueId()
  const share = createConfigShare()
  return <div class="space-y-6">
    <p class="text-sm text-muted-foreground">{share.text("share_description")}</p>
    <ExportSettings id={id} share={share} />
    <ImportSettings id={id} share={share} />
    <Button type="button" variant="ghost" onClick={share.cancel} disabled={!share.canCancel()}>{share.text("share_cancel")}</Button>
    <Show when={share.error()}><p role="alert" class="text-sm text-destructive">{share.error()}</p></Show>
    <Show when={share.status()}><p role="status" class="text-sm">{share.status()}</p></Show>
  </div>
}
