import { useEffect, useState } from "react"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { getErrorMessage } from "@services/api"
import { StatusLine } from "./StatusLine"
import type { SectionMessage, SystemBambooConfig, SystemConfigApi } from "./useSystemConfig"

// Backend-accepted modes (engine message_hooks.rs): placeholder | error | ocr.
// lotus additionally offered "vision", but the engine rejects it at run time.
type FallbackMode = "placeholder" | "error" | "ocr"

const MODE_OPTIONS: Array<{ value: FallbackMode; label: string }> = [
  { value: "placeholder", label: "占位文本替换" },
  { value: "error", label: "直接报错" },
  { value: "ocr", label: "OCR 提取文本" },
]

function normalizeMode(raw: unknown): FallbackMode {
  const mode = String(raw ?? "placeholder").trim().toLowerCase()
  return mode === "error" || mode === "ocr" ? mode : "placeholder"
}

/** Hooks — 图片预检回退(config `hooks.image_fallback`),改动即保存. */
export function SectionHooks({
  config,
  saveSection,
}: {
  config: SystemBambooConfig
  saveSection: SystemConfigApi["saveSection"]
}) {
  const [enabled, setEnabled] = useState(false)
  const [mode, setMode] = useState<FallbackMode>("placeholder")
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<SectionMessage>(null)

  useEffect(() => {
    setEnabled(config.hooks?.image_fallback?.enabled === true)
    setMode(normalizeMode(config.hooks?.image_fallback?.mode))
  }, [config])

  const apply = async (nextEnabled: boolean, nextMode: FallbackMode) => {
    const prev = { enabled, mode }
    setEnabled(nextEnabled)
    setMode(nextMode)
    setBusy(true)
    setMsg(null)
    try {
      await saveSection({ hooks: { image_fallback: { enabled: nextEnabled, mode: nextMode } } })
      setMsg({ kind: "ok", text: "已保存" })
    } catch (e) {
      setEnabled(prev.enabled)
      setMode(prev.mode)
      setMsg({ kind: "error", text: getErrorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-2 rounded-lg border p-3">
      <div className="text-xs font-medium text-muted-foreground">Hooks</div>
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm">图片预检回退</div>
          <div className="text-xs text-muted-foreground">
            当模型不支持图片输入时,按所选方式处理图片内容
          </div>
        </div>
        <Switch
          checked={enabled}
          disabled={busy}
          onCheckedChange={(checked) => void apply(checked, mode)}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm">回退方式</div>
        <Select
          value={mode}
          disabled={!enabled || busy}
          onValueChange={(value) => void apply(enabled, value as FallbackMode)}
        >
          <SelectTrigger className="w-44" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <StatusLine msg={msg} />
    </section>
  )
}
