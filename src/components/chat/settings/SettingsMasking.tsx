import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useEffect, useMemo, useState } from "react"
import { Trash2, Plus } from "lucide-react"
import { serviceFactory } from "@services/common/ServiceFactory"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type Entry = { pattern: string; match_type: string; enabled: boolean }

// Mirrors the backend `MatchType` enum: "exact" is a substring search, "regex"
// a pattern match. Any other value is rejected by the config schema.
const MATCH_TYPES = ["exact", "regex"]

export function SettingsMasking() {
  useUiLocale()
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [pattern, setPattern] = useState("")
  const [matchType, setMatchType] = useState("exact")

  useEffect(() => {
    serviceFactory
      .getKeywordMaskingConfig()
      .then((r) => setEntries(r.entries))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const save = async (next: Entry[]) => {
    setEntries(next)
    try {
      const r = await serviceFactory.updateKeywordMaskingConfig(next)
      setEntries(r.entries)
    } catch {
      /* ignore */
    }
  }

  const add = () => {
    if (!pattern.trim()) return
    void save([...entries, { pattern: pattern.trim(), match_type: matchType, enabled: true }])
    setPattern("")
  }

  const [sample, setSample] = useState("")
  const masked = useMemo(() => {
    let out = sample
    for (const e of entries) {
      if (!e.enabled || !e.pattern) continue
      try {
        if (e.match_type === "regex") out = out.replace(new RegExp(e.pattern, "g"), "***")
        else out = out.split(e.pattern).join("***")
      } catch {
        /* invalid regex — skip */
      }
    }
    return out
  }, [sample, entries])

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-muted-foreground">
        {uiText("matches_are_masked_before_being_sent_to_models_or_logs__c8a6d58b")}</p>

      <section className="space-y-2 rounded-lg border p-3">
        <div className="text-xs font-medium text-muted-foreground">{uiText("add_rule_83009fcf")}</div>
        <div className="flex gap-2">
          <Input
            className="flex-1"
            placeholder={uiText("content_pattern_to_mask_d870245d")}
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add()
            }}
          />
          <Select value={matchType} onValueChange={setMatchType}>
            <SelectTrigger className="w-28 shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MATCH_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={add} disabled={!pattern.trim()}>
            <Plus className="size-4" />
          </Button>
        </div>
      </section>

      <section className="rounded-lg border p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">{uiText("masking_rules_5f1fa4a9")}{entries.length})</div>
        {loading ? (
          <p className="text-xs text-muted-foreground">{uiText("loading_4927a53b")}</p>
        ) : entries.length === 0 ? (
          <p className="text-xs text-muted-foreground">{uiText("none_yet_b336a174")}</p>
        ) : (
          <ul className="space-y-1.5">
            {entries.map((e, i) => (
              <li key={`${e.pattern}-${i}`} className="flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-1.5">
                <Switch
                  checked={e.enabled}
                  onCheckedChange={() =>
                    void save(entries.map((x, j) => (j === i ? { ...x, enabled: !x.enabled } : x)))
                  }
                  aria-label={uiText("enable_rule_d23ee517")}
                />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{e.pattern}</span>
                <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                  {e.match_type}
                </span>
                <button
                  onClick={() => void save(entries.filter((_, j) => j !== i))}
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

      <section className="space-y-2 rounded-lg border p-3">
        <div className="text-xs font-medium text-muted-foreground">{uiText("preview_13d61fea")}</div>
        <Textarea
          className="min-h-16 resize-y rounded-md border px-2.5 py-1.5 text-sm"
          placeholder={uiText("enter_text_to_preview_masking_48b25eea")}
          value={sample}
          onChange={(e) => setSample(e.target.value)}
        />
        {sample ? (
          <div className="rounded-md bg-muted/40 p-2.5 text-sm [overflow-wrap:anywhere]">{masked}</div>
        ) : null}
      </section>
    </div>
  )
}
