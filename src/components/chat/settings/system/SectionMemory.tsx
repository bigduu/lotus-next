import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { getErrorMessage } from "@services/api"
import { StatusLine } from "./StatusLine"
import type { SectionMessage, SystemBambooConfig, SystemConfigApi } from "./useSystemConfig"

const DEFAULT_INTERVAL_SECS = 1800

/** 记忆 — auto-Dream 后台整理开关 + 间隔(backend `memory.*`). */
export function SectionMemory({
  config,
  saveSection,
}: {
  config: SystemBambooConfig
  saveSection: SystemConfigApi["saveSection"]
}) {
  useUiLocale()
  // Seed once at mount: re-seeding on config change would clobber in-progress
  // edits whenever another section saves (each save reloads the shared config).
  // Backend default for auto_dream_enabled is ON when the field is omitted.
  const [enabled, setEnabled] = useState(() => config.memory?.auto_dream_enabled ?? true)
  const [intervalSecs, setIntervalSecs] = useState(() =>
    String(config.memory?.auto_dream_interval_secs ?? DEFAULT_INTERVAL_SECS)
  )
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<SectionMessage>(null)

  const save = async () => {
    const parsed = Number(intervalSecs)
    if (!Number.isInteger(parsed) || parsed < 60) {
      setMsg({ kind: "error", text: uiText("interval_must_be_an_integer_of_at_least_60_seconds_2e4fa5c6") })
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      await saveSection({
        memory: { auto_dream_enabled: enabled, auto_dream_interval_secs: parsed },
      })
      setMsg({ kind: "ok", text: uiText("saved_1bd91a7d") })
    } catch (e) {
      setMsg({ kind: "error", text: getErrorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-2 rounded-lg border p-3">
      <div className="text-xs font-medium text-muted-foreground">{uiText("memory_7a6335b3")}</div>
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm">{uiText("automatic_organization_auto_dream_1e2006e6")}</div>
          <div className="text-xs text-muted-foreground">{uiText("organize_session_memory_periodically_in_the_background_95c196c4")}</div>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm">{uiText("organization_interval_seconds_0a821075")}</div>
        <Input
          className="w-28 text-right"
          inputMode="numeric"
          placeholder={String(DEFAULT_INTERVAL_SECS)}
          value={intervalSecs}
          onChange={(e) => setIntervalSecs(e.target.value)}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <StatusLine msg={msg} />
        <Button size="sm" className="ml-auto" onClick={save} disabled={busy}>
          {busy ? uiText("saving_ff509c9b") : uiText("save_a3030bf8")}
        </Button>
      </div>
    </section>
  )
}
