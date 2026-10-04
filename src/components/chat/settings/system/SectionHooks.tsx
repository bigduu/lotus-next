import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useState } from "react"
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
  { value: "placeholder", get label() { return uiText("replace_with_placeholder_text_a3640565") } },
  { value: "error", get label() { return uiText("return_an_error_3d9f8301") } },
  { value: "ocr", get label() { return uiText("extract_text_with_ocr_f28621fc") } },
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
  useUiLocale()
  // Seed once at mount: re-seeding on config change would clobber in-progress
  // edits whenever another section saves (each save reloads the shared config).
  const [enabled, setEnabled] = useState(() => config.hooks?.image_fallback?.enabled === true)
  const [mode, setMode] = useState<FallbackMode>(() =>
    normalizeMode(config.hooks?.image_fallback?.mode)
  )
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<SectionMessage>(null)

  const apply = async (nextEnabled: boolean, nextMode: FallbackMode) => {
    const prev = { enabled, mode }
    setEnabled(nextEnabled)
    setMode(nextMode)
    setBusy(true)
    setMsg(null)
    try {
      await saveSection({ hooks: { image_fallback: { enabled: nextEnabled, mode: nextMode } } })
      setMsg({ kind: "ok", text: uiText("saved_1bd91a7d") })
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
          <div className="text-sm">{uiText("image_preflight_fallback_db10bcdd")}</div>
          <div className="text-xs text-muted-foreground">
            {uiText("choose_how_to_handle_images_when_the_model_does_not_sup_91164dd4")}</div>
        </div>
        <Switch
          checked={enabled}
          disabled={busy}
          onCheckedChange={(checked) => void apply(checked, mode)}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm">{uiText("fallback_method_7d710102")}</div>
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
