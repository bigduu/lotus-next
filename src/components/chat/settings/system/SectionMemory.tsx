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
      setMsg({ kind: "error", text: "间隔需为不小于 60 的整数秒" })
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      await saveSection({
        memory: { auto_dream_enabled: enabled, auto_dream_interval_secs: parsed },
      })
      setMsg({ kind: "ok", text: "已保存" })
    } catch (e) {
      setMsg({ kind: "error", text: getErrorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-2 rounded-lg border p-3">
      <div className="text-xs font-medium text-muted-foreground">记忆</div>
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm">自动整理(auto-Dream)</div>
          <div className="text-xs text-muted-foreground">后台定期整理会话记忆</div>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm">整理间隔(秒)</div>
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
          {busy ? "保存中…" : "保存"}
        </Button>
      </div>
    </section>
  )
}
