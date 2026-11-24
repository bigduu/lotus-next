import { For, Show, createSignal, onSettled } from "solid-js"
import { Plus, Trash2 } from "@lucide/solid"
import { parseSessionPermissionMode } from "@services/chat/AgentService"
import { settingsService, type DefaultSessionPermissionMode, type SessionPermissionModeValue } from "@services/config/SettingsService"
import { isApiError } from "@services/api/errors"
import { cn } from "@/lib/utils"
import { createUiText } from "../../shell/uiText"
import { Button } from "../../ui/button"
import { Input } from "../../ui/input"

const MODE_OPTIONS = [
  { value: "default", label: "Default", hint: "ask_before_dangerous_operations_1949266f", danger: false },
  { value: "bypass", label: "Bypass", hint: "skip_ordinary_approvals_forced_confirmation_rules_still_d1272ac8", danger: true },
  { value: "auto", label: "Auto", hint: "no_approval_dialogs_hard_deny_policies_still_apply_73c31eb7", danger: true },
] as const

type Policy = Pick<DefaultSessionPermissionMode, "mode" | "revision" | "supervisor_approval_handoff_enabled">
type PolicyUpdate = { mode: SessionPermissionModeValue } | { handoff: boolean }

function confirmedPolicy(value: DefaultSessionPermissionMode): Policy {
  const mode = parseSessionPermissionMode(value?.mode)
  const revision = value?.revision
  const handoff = value?.supervisor_approval_handoff_enabled
  if (!mode || !Number.isSafeInteger(revision) || revision < 0 ||
    (handoff !== undefined && typeof handoff !== "boolean")) {
    throw new Error("Invalid permission policy acknowledgement")
  }
  return { mode, revision, supervisor_approval_handoff_enabled: handoff }
}

const isAccessDenied = (failure: unknown): boolean =>
  isApiError(failure) && (failure.status === 401 || failure.status === 403)

function ApprovalDefaults() {
  const text = createUiText()
  const [policy, setPolicy] = createSignal<Policy | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  let mounted = true

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      const current = confirmedPolicy(await settingsService.getDefaultSessionPermissionMode())
      if (mounted) setPolicy(current)
    } catch {
      if (mounted) {
        setPolicy(null)
        setError(text("could_not_load_default_permission_mode_f3b27a89"))
      }
    } finally {
      if (mounted) setLoading(false)
    }
  }
  onSettled(() => {
    void refresh()
    return () => { mounted = false }
  })

  const save = async (update: PolicyUpdate) => {
    const current = policy()
    if (!current || loading() || saving()) return
    if ("mode" in update ? update.mode === current.mode : update.handoff === current.supervisor_approval_handoff_enabled) return
    setSaving(true)
    setError(null)
    try {
      const saved = confirmedPolicy("mode" in update
        ? await settingsService.updateDefaultSessionPermissionMode(update.mode, current.revision)
        : await settingsService.updateSupervisorApprovalHandoff(update.handoff, current.revision))
      if (!mounted) return
      if (saved.revision < current.revision) throw new Error("Stale permission policy acknowledgement")
      setPolicy(saved)
      const confirmed = "mode" in update ? saved.mode === update.mode : saved.supervisor_approval_handoff_enabled === update.handoff
      if (!confirmed) setError(text("could_not_save_please_try_again_f42a1238"))
    } catch (failure) {
      if (!mounted) return
      setError(text("could_not_save_please_try_again_f42a1238"))
      if (isAccessDenied(failure)) {
        setPolicy(null)
      } else if (isApiError(failure) && failure.status === 409) {
        try {
          const latest = confirmedPolicy(await settingsService.getDefaultSessionPermissionMode())
          if (!mounted) return
          setPolicy(latest)
          // Only a fresh user decision may submit another revision.
          setError(text("the_request_or_permissions_have_changed_confirm_again_u_a1ebae48"))
        } catch {
          if (mounted) setPolicy(null)
        }
      }
    } finally {
      if (mounted) setSaving(false)
    }
  }

  const hint = () => MODE_OPTIONS.find((option) => option.value === policy()?.mode)?.hint
  return (
    <>
      <section class="space-y-2 rounded-lg border p-3">
        <div class="text-xs font-medium text-muted-foreground">{text("default_permissions_for_new_sessions_5ac6c44c")}</div>
        <div class="flex gap-2">
          <For each={MODE_OPTIONS}>{(option) => (
            <Button type="button"
              variant={policy()?.mode === option.value ? "default" : "secondary"}
              disabled={!policy() || loading() || saving()}
              onClick={() => void save({ mode: option.value })}
              class={cn("flex-1", policy()?.mode === option.value && option.danger &&
                "border-amber-500/60 text-amber-600 dark:text-amber-400")}>
              {option.label}
            </Button>
          )}</For>
        </div>
        <p class="text-xs leading-relaxed text-muted-foreground">
          {loading() ? text("loading_4927a53b") : saving() ? text("saving_ff509c9b") : hint() ? text(hint()!) : null}
          {text("only_affects_new_sessions_existing_sessions_keep_their__770c0ec9")}
        </p>
      </section>
      <Show when={policy()?.supervisor_approval_handoff_enabled !== undefined}>
        <section class="space-y-2 rounded-lg border p-3">
          <div class="text-xs font-medium text-muted-foreground">{text("supervisor_approval_handoff_setting")}</div>
          <p class="text-xs text-muted-foreground">{text("supervisor_approval_handoff_description")}</p>
          <Button type="button" variant="outline" size="sm" data-permission-handoff=""
            aria-pressed={policy()?.supervisor_approval_handoff_enabled ? "true" : "false"}
            disabled={loading() || saving()}
            onClick={() => {
              const enabled = policy()?.supervisor_approval_handoff_enabled
              if (enabled !== undefined) void save({ handoff: !enabled })
            }}>
            {text(policy()?.supervisor_approval_handoff_enabled ? "supervisor_approval_handoff_on" : "supervisor_approval_handoff_off")}
          </Button>
        </section>
      </Show>
      <Show when={error()}><p role="alert" class="text-xs text-destructive">{error()}</p></Show>
      <Show when={!policy() && !loading()}>
        <Button type="button" size="sm" variant="secondary"
          disabled={saving()} onClick={() => void refresh()}>{text("retry_b8784c8d")}</Button>
      </Show>
    </>
  )
}

function confirmedRules(value: string[]): string[] {
  if (!Array.isArray(value) || !value.every((rule) => typeof rule === "string")) {
    throw new Error("Invalid approval rules acknowledgement")
  }
  return value
}

function ApprovalRules() {
  const text = createUiText()
  const [rules, setRules] = createSignal<string[] | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [saving, setSaving] = createSignal(false)
  const [draft, setDraft] = createSignal("")
  const [error, setError] = createSignal<string | null>(null)
  let mounted = true

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      const current = confirmedRules(await settingsService.getPermissionAskRules())
      if (mounted) setRules(current)
    } catch {
      if (mounted) {
        setRules(null)
        setError(text("state_unavailable_a9dcef67"))
      }
    } finally {
      if (mounted) setLoading(false)
    }
  }
  onSettled(() => {
    void refresh()
    return () => { mounted = false }
  })

  const save = async (next: string[]): Promise<boolean> => {
    if (loading() || saving() || !rules()) return false
    setSaving(true)
    setError(null)
    try {
      const stored = confirmedRules(await settingsService.updatePermissionAskRules(next))
      if (!mounted) return false
      setRules(stored)
      return true
    } catch (failure) {
      if (mounted) {
        if (isAccessDenied(failure)) setRules(null)
        setError(text("could_not_save_please_try_again_f42a1238"))
      }
      return false
    } finally {
      if (mounted) setSaving(false)
    }
  }

  const blocked = () => loading() || saving() || rules() === null
  const add = async () => {
    const current = rules()
    const rule = draft().trim()
    if (!current || !rule || current.includes(rule)) return
    if (await save([...current, rule])) setDraft("")
  }
  const remove = (rule: string) => {
    const current = rules()
    if (current) void save(current.filter((item) => item !== rule))
  }
  return (
    <>
      <p class="text-xs text-muted-foreground">
        <For each={text("approval_rule_example").split(/(<code>[^<]*<\/code>)/u)}>
          {(part) => part.startsWith("<code>") && part.endsWith("</code>") ? <code>{part.slice(6, -7)}</code> : part}
        </For>
      </p>
      <section class="space-y-2 rounded-lg border p-3">
        <div class="text-xs font-medium text-muted-foreground">{text("add_rule_83009fcf")}</div>
        <div class="flex gap-2">
          <Input class="flex-1" aria-label={text("tool_name_pattern_a8384820")} placeholder={text("tool_name_pattern_a8384820")}
            disabled={blocked()} value={draft()} onInput={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.isComposing && event.keyCode !== 229) {
                event.preventDefault()
                void add()
              }
            }} />
          <Button type="button" size="sm" onClick={() => void add()} disabled={blocked() || !draft().trim()}>
            <Plus class="size-4" />{text("add_7a8a11ea")}
          </Button>
        </div>
      </section>
      <section class="rounded-lg border p-3">
        <div class="mb-2 text-xs font-medium text-muted-foreground">
          {text("approval_rules_f747dce1")}{rules()?.length ?? "—"})
        </div>
        <Show when={loading()}><p role="status" class="text-xs text-muted-foreground">{text("loading_4927a53b")}</p></Show>
        <Show when={rules()}>{(current) => (
          <Show when={current().length} fallback={
            <p class="text-xs text-muted-foreground">{text("none_all_tools_execute_directly_6f32e54e")}</p>
          }>
            <ul class="space-y-1.5">
              <For each={current()}>{(rule) => (
                <li class="flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-1.5">
                  <span class="min-w-0 flex-1 truncate font-mono text-xs">{rule}</span>
                  <button type="button" onClick={() => remove(rule)} aria-label={text("delete_2f9daa82")}
                    disabled={blocked()} class="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive disabled:opacity-50">
                    <Trash2 class="size-3.5" />
                  </button>
                </li>
              )}</For>
            </ul>
          </Show>
        )}</Show>
        <Show when={error()}><p role="alert" class="mt-2 text-xs text-destructive">{error()}</p></Show>
        <Show when={!rules() && !loading()}>
          <Button type="button" size="sm" variant="secondary" class="mt-2"
            disabled={saving()} onClick={() => void refresh()}>{text("retry_b8784c8d")}</Button>
        </Show>
      </section>
    </>
  )
}

export function SettingsPermissions(props: { ownerAccess: boolean }) {
  return (
    <Show when={props.ownerAccess}>
      <div class="space-y-4" data-settings-permissions="">
        <ApprovalDefaults />
        <ApprovalRules />
      </div>
    </Show>
  )
}
