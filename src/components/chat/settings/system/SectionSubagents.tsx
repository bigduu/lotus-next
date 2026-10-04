import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getErrorMessage } from "@services/api"
import { StatusLine } from "./StatusLine"
import type { SectionMessage, SystemBambooConfig, SystemConfigApi } from "./useSystemConfig"

/** 子代理 — `subagents.max_concurrent`(留空则用后端默认 8). */
export function SectionSubagents({
  config,
  saveSection,
}: {
  config: SystemBambooConfig
  saveSection: SystemConfigApi["saveSection"]
}) {
  useUiLocale()
  // Seed once at mount: re-seeding on config change would clobber in-progress
  // edits whenever another section saves (each save reloads the shared config).
  const [maxConcurrent, setMaxConcurrent] = useState(() => {
    const value = config.subagents?.max_concurrent
    return typeof value === "number" ? String(value) : ""
  })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<SectionMessage>(null)

  const save = async () => {
    const trimmed = maxConcurrent.trim()
    let value: number | null = null
    if (trimmed) {
      const parsed = Number(trimmed)
      if (!Number.isInteger(parsed) || parsed < 1) {
        setMsg({ kind: "error", text: uiText("concurrency_must_be_an_integer_of_at_least_1_9240ee0f") })
        return
      }
      value = parsed
    }
    setBusy(true)
    setMsg(null)
    try {
      // `null` clears the override back to the backend default (deep-merge
      // replaces the value; omitting the key would leave it unchanged).
      await saveSection({
        subagents: { max_concurrent: value as unknown as number | undefined },
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
      <div className="text-xs font-medium text-muted-foreground">{uiText("sub_agent_acd37b4c")}</div>
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm">{uiText("maximum_concurrency_dd9fd5ce")}</div>
          <div className="text-xs text-muted-foreground">{uiText("maximum_simultaneous_subagent_processes_leave_blank_for_c6efded8")}</div>
        </div>
        <Input
          className="w-24 text-right"
          inputMode="numeric"
          placeholder="8"
          value={maxConcurrent}
          onChange={(e) => setMaxConcurrent(e.target.value)}
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
