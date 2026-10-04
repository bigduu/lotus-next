import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useEffect, useState } from "react"
import { Trash2, Plus } from "lucide-react"
import { settingsService, type SessionPermissionModeValue } from "@services/config/SettingsService"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

const MODE_OPTIONS: Array<{
  value: SessionPermissionModeValue
  label: string
  hint: string
  danger?: boolean
}> = [
  { value: "default", label: "Default", get hint() { return uiText("ask_before_dangerous_operations_1949266f") } },
  { value: "bypass", label: "Bypass", get hint() { return uiText("skip_ordinary_approvals_forced_confirmation_rules_still_d1272ac8") }, danger: true },
  { value: "auto", label: "Auto", get hint() { return uiText("no_approval_dialogs_hard_deny_policies_still_apply_73c31eb7") }, danger: true },
]

function DefaultModeSection() {
  useUiLocale()
  const [mode, setMode] = useState<SessionPermissionModeValue>("default")
  const [revision, setRevision] = useState<number | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    settingsService
      .getDefaultSessionPermissionMode()
      .then((res) => {
        setMode(res.mode)
        setRevision(res.revision)
      })
      .catch(() => setError(uiText("could_not_load_default_permission_mode_f3b27a89")))
      .finally(() => setLoading(false))
  }, [])

  const save = async (next: SessionPermissionModeValue) => {
    if (next === mode || saving) return
    const previous = mode
    setMode(next)
    setSaving(true)
    setError(null)
    try {
      const saved = await settingsService.updateDefaultSessionPermissionMode(next, revision)
      setRevision(saved.revision)
    } catch {
      setMode(previous)
      setError(uiText("could_not_save_please_try_again_f42a1238"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-2 rounded-lg border p-3">
      <div className="text-xs font-medium text-muted-foreground">{uiText("default_permissions_for_new_sessions_5ac6c44c")}</div>
      <div className="flex gap-2">
        {MODE_OPTIONS.map((option) => (
          <Button
            key={option.value}
            variant={mode === option.value ? "default" : "secondary"}
            disabled={loading || saving}
            onClick={() => void save(option.value)}
            className={cn(
              "flex-1",
              mode === option.value && option.danger && "border-amber-500/60 text-amber-600 dark:text-amber-400",
            )}
          >
            {option.label}
          </Button>
        ))}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {loading ? uiText("loading_4927a53b") : saving ? uiText("saving_ff509c9b") : MODE_OPTIONS.find((o) => o.value === mode)?.hint}
        {uiText("only_affects_new_sessions_existing_sessions_keep_their__770c0ec9")}</p>
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </section>
  )
}

export function SettingsPermissions() {
  useUiLocale()
  const [rules, setRules] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState("")

  useEffect(() => {
    settingsService
      .getPermissionAskRules()
      .then(setRules)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const save = async (next: string[]) => {
    setRules(next)
    try {
      const saved = await settingsService.updatePermissionAskRules(next)
      setRules(saved)
    } catch {
      /* ignore */
    }
  }

  const add = () => {
    const r = draft.trim()
    if (!r || rules.includes(r)) return
    void save([...rules, r])
    setDraft("")
  }

  return (
    <div className="space-y-4">
      <DefaultModeSection />

      <p className="text-xs text-muted-foreground">
        {uiText("matching_tool_calls_require_approval_before_execution_r_3485673a")} <code>Bash</code>、<code>write_file</code>)。
      </p>

      <section className="space-y-2 rounded-lg border p-3">
        <div className="text-xs font-medium text-muted-foreground">{uiText("add_rule_83009fcf")}</div>
        <div className="flex gap-2">
          <Input
            className="flex-1"
            placeholder={uiText("tool_name_pattern_a8384820")}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add()
            }}
          />
          <Button size="sm" onClick={add} disabled={!draft.trim()}>
            <Plus className="size-4" />{uiText("add_7a8a11ea")}</Button>
        </div>
      </section>

      <section className="rounded-lg border p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">{uiText("approval_rules_f747dce1")}{rules.length})</div>
        {loading ? (
          <p className="text-xs text-muted-foreground">{uiText("loading_4927a53b")}</p>
        ) : rules.length === 0 ? (
          <p className="text-xs text-muted-foreground">{uiText("none_all_tools_execute_directly_6f32e54e")}</p>
        ) : (
          <ul className="space-y-1.5">
            {rules.map((r) => (
              <li key={r} className="flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-1.5">
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{r}</span>
                <button
                  onClick={() => void save(rules.filter((x) => x !== r))}
                  aria-label={uiText("delete_2f9daa82")}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
