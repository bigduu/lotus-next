import { useEffect, useMemo, useState } from "react"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { apiClient, getErrorMessage } from "@services/api"
import { StatusLine } from "./StatusLine"
import type { SectionMessage, SystemBambooConfig, SystemConfigApi } from "./useSystemConfig"

const normalizeNames = (names: string[]): string[] =>
  [...new Set(names.map((n) => n.trim()).filter(Boolean))].sort()

/** 工具 — 全局禁用列表 `tools.disabled`(关闭的工具不会发给模型). */
export function SectionTools({
  config,
  saveSection,
}: {
  config: SystemBambooConfig
  saveSection: SystemConfigApi["saveSection"]
}) {
  const [available, setAvailable] = useState<string[]>([])
  // Seed once at mount: re-seeding on config change would clobber in-progress
  // edits whenever another section saves (each save reloads the shared config).
  const [disabled, setDisabled] = useState<string[]>(() =>
    normalizeNames((config.tools?.disabled ?? []).filter((n): n is string => typeof n === "string"))
  )
  const [saved, setSaved] = useState<string[]>(disabled)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<SectionMessage>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const loadTools = () => {
    setLoadError(null)
    // Direct apiClient call: serviceFactory.getBambooTools swallows failures
    // into `{ tools: [] }`, which would silently render as "no tools".
    apiClient
      .get<{ tools: string[] }>("bamboo/tools")
      .then((r) => setAvailable(normalizeNames(r.tools ?? [])))
      .catch((e) => setLoadError(getErrorMessage(e)))
  }
  useEffect(loadTools, [])

  // Show stale disabled entries too, so they can be re-enabled even if the
  // tool no longer exists in the registry.
  const allNames = useMemo(() => normalizeNames([...available, ...disabled]), [available, disabled])
  const disabledSet = useMemo(() => new Set(disabled), [disabled])
  const dirty = JSON.stringify(disabled) !== JSON.stringify(saved)

  const toggle = (name: string, enabled: boolean) => {
    setDisabled((prev) => {
      const next = new Set(prev)
      if (enabled) next.delete(name)
      else next.add(name)
      return normalizeNames([...next])
    })
  }

  const save = async () => {
    setBusy(true)
    setMsg(null)
    try {
      await saveSection({ tools: { disabled } })
      setSaved(disabled)
      setMsg({ kind: "ok", text: "已保存" })
    } catch (e) {
      setMsg({ kind: "error", text: getErrorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-muted-foreground">工具</div>
        <button
          onClick={loadTools}
          aria-label="重新加载工具列表"
          className="rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className="size-3.5" />
        </button>
      </div>
      <p className="text-xs text-muted-foreground">关闭的工具将从模型可用工具中全局移除。</p>
      {loadError ? <p className="text-xs text-destructive">工具列表加载失败:{loadError}</p> : null}

      {allNames.length === 0 ? (
        <p className="text-xs text-muted-foreground">暂无工具</p>
      ) : (
        <ul className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
          {allNames.map((name) => (
            <li key={name} className="flex items-center justify-between gap-2">
              <code className="truncate font-mono text-xs">{name}</code>
              <Switch
                checked={!disabledSet.has(name)}
                onCheckedChange={(enabled) => toggle(name, enabled)}
                aria-label={name}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between gap-2">
        <StatusLine msg={msg} />
        <Button size="sm" className="ml-auto" onClick={save} disabled={busy || !dirty}>
          {busy ? "保存中…" : "保存"}
        </Button>
      </div>
    </section>
  )
}
