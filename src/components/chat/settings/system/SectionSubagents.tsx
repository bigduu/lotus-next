import { useEffect, useState } from "react"
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
  const [maxConcurrent, setMaxConcurrent] = useState("")
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<SectionMessage>(null)

  useEffect(() => {
    const value = config.subagents?.max_concurrent
    setMaxConcurrent(typeof value === "number" ? String(value) : "")
  }, [config])

  const save = async () => {
    const trimmed = maxConcurrent.trim()
    let value: number | null = null
    if (trimmed) {
      const parsed = Number(trimmed)
      if (!Number.isInteger(parsed) || parsed < 1) {
        setMsg({ kind: "error", text: "并发上限需为不小于 1 的整数" })
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
      setMsg({ kind: "ok", text: "已保存" })
    } catch (e) {
      setMsg({ kind: "error", text: getErrorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-2 rounded-lg border p-3">
      <div className="text-xs font-medium text-muted-foreground">子代理</div>
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm">最大并发数</div>
          <div className="text-xs text-muted-foreground">同时运行的子代理进程上限,留空使用默认(8)</div>
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
          {busy ? "保存中…" : "保存"}
        </Button>
      </div>
    </section>
  )
}
