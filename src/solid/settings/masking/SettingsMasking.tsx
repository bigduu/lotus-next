import { Plus, Trash2 } from "@lucide/solid"
import { createMemo, createSignal, For, onSettled, Show } from "solid-js"
import { apiClient } from "@services/api"
import { serviceFactory } from "@services/common/ServiceFactory"
import { createUiText } from "../../shell/uiText"
import { Button } from "../../ui/button"
import { Input } from "../../ui/input"
import { Select } from "../../ui/select"
import { Switch } from "../../ui/switch"
import { Textarea } from "../../ui/textarea"

type Entry = { pattern: string; match_type: string; enabled: boolean }
const matchTypes = [{ value: "exact", label: "exact" }, { value: "regex", label: "regex" }]

export function SettingsMasking() {
  const text = createUiText()
  const [entries, setEntries] = createSignal<Entry[]>([])
  const [loading, setLoading] = createSignal(true)
  const [confirmed, setConfirmed] = createSignal(false)
  const [saving, setSaving] = createSignal(false)
  const [failed, setFailed] = createSignal(false)
  const [pattern, setPattern] = createSignal("")
  const [matchType, setMatchType] = createSignal("exact")
  const [sample, setSample] = createSignal("")
  let mounted = true
  let inFlight = false

  const load = async () => {
    setLoading(true)
    setFailed(false)
    try {
      const config = await apiClient.get<{ entries: Entry[] }>("bamboo/keyword-masking")
      if (!Array.isArray(config.entries)) throw new Error("Invalid keyword masking configuration")
      if (mounted) {
        setEntries(config.entries)
        setConfirmed(true)
      }
    } catch {
      if (mounted) {
        setConfirmed(false)
        setFailed(true)
      }
    } finally {
      if (mounted) setLoading(false)
    }
  }
  onSettled(() => {
    void load()
    return () => { mounted = false }
  })

  const save = async (next: Entry[]) => {
    if (inFlight || loading() || !confirmed()) return false
    inFlight = true
    setSaving(true)
    setFailed(false)
    try {
      const config = await serviceFactory.updateKeywordMaskingConfig(next)
      if (mounted) setEntries(config.entries)
      return true
    } catch {
      if (mounted) {
        await load()
        if (mounted) setFailed(true)
      }
      return false
    } finally {
      inFlight = false
      if (mounted) setSaving(false)
    }
  }

  const add = async () => {
    const value = pattern().trim()
    if (!value) return
    const saved = await save([...entries(), { pattern: value, match_type: matchType(), enabled: true }])
    if (saved && mounted) setPattern("")
  }

  const masked = createMemo(() => {
    let result = sample()
    for (const entry of entries()) {
      if (!entry.enabled || !entry.pattern) continue
      try {
        result = entry.match_type === "regex" ? result.replace(new RegExp(entry.pattern, "g"), "***") : result.split(entry.pattern).join("***")
      } catch { /* A persisted unsupported regex has no effect in the preview. */ }
    }
    return result
  })

  return (
    <div class="space-y-3">
      <p class="text-xs leading-relaxed text-muted-foreground">{text("matches_are_masked_before_being_sent_to_models_or_logs__c8a6d58b")}</p>
      <form class="space-y-2 rounded-lg border p-3" onSubmit={(event) => { event.preventDefault(); void add() }}>
        <div class="text-xs font-medium text-muted-foreground">{text("add_rule_83009fcf")}</div>
        <div class="flex gap-2">
          <Input class="flex-1" aria-label={text("content_pattern_to_mask_d870245d")} placeholder={text("content_pattern_to_mask_d870245d")}
            disabled={saving()} value={pattern()} onInput={(event) => setPattern(event.currentTarget.value)} />
          <Select class="w-28 shrink-0" label={text("masking_match_type")} options={matchTypes} disabled={saving()}
            value={matchType()} onValueChange={setMatchType} />
          <Button size="sm" type="submit" disabled={!pattern().trim() || !confirmed() || loading() || saving()} aria-label={text("add_rule_83009fcf")}>
            <Plus class="size-4" />
          </Button>
        </div>
      </form>
      <Show when={failed()}>
        <div class="flex items-center gap-2">
          <p role="alert" class="text-xs text-destructive">{text("operation_failed_0c3b4cf7")}</p>
          <Show when={!confirmed()}>
            <Button type="button" size="sm" variant="secondary" disabled={loading() || saving()} onClick={() => { void load() }}>
              {text("retry_b8784c8d")}
            </Button>
          </Show>
        </div>
      </Show>
      <section class="rounded-lg border p-3">
        <div class="mb-2 text-xs font-medium text-muted-foreground">{text("masking_rules_5f1fa4a9")}{entries().length})</div>
        <Show when={!loading()} fallback={<p role="status" class="text-xs text-muted-foreground">{text("loading_4927a53b")}</p>}>
          <Show when={entries().length > 0} fallback={<p class="text-xs text-muted-foreground">{text("none_yet_b336a174")}</p>}>
            <ul class="space-y-1.5">
              <For each={entries()} keyed={false}>{(entry, index) => (
                <li class="flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-1.5">
                  <Switch checked={entry().enabled} disabled={saving() || !confirmed()} aria-label={text("enable_rule_d23ee517")}
                    onCheckedChange={(enabled) => { void save(entries().map((item, position) => position === index ? { ...item, enabled } : item)) }} />
                  <span class="min-w-0 flex-1 truncate font-mono text-xs">{entry().pattern}</span>
                  <span class="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">{entry().match_type}</span>
                  <button type="button" disabled={saving() || !confirmed()} aria-label={text("delete_2f9daa82")}
                    class="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
                    onClick={() => { void save(entries().filter((_, position) => position !== index)) }}>
                    <Trash2 class="size-3.5" />
                  </button>
                </li>
              )}</For>
            </ul>
          </Show>
        </Show>
      </section>
      <section class="space-y-2 rounded-lg border p-3">
        <div class="text-xs font-medium text-muted-foreground">{text("preview_13d61fea")}</div>
        <Textarea class="min-h-16 resize-y rounded-md border px-2.5 py-1.5 text-sm"
          aria-label={text("enter_text_to_preview_masking_48b25eea")} placeholder={text("enter_text_to_preview_masking_48b25eea")}
          value={sample()} onInput={(event) => setSample(event.currentTarget.value)} />
        <Show when={sample()}><div class="rounded-md bg-muted/40 p-2.5 text-sm [overflow-wrap:anywhere]">{masked()}</div></Show>
      </section>
    </div>
  )
}
