import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getErrorMessage } from "@services/api"
import { StatusLine } from "./StatusLine"
import type { SectionMessage, SystemBambooConfig, SystemConfigApi } from "./useSystemConfig"

/** 代理 — edits `http_proxy` / `https_proxy` on the bamboo config. */
export function SectionProxy({
  config,
  saveSection,
}: {
  config: SystemBambooConfig
  saveSection: SystemConfigApi["saveSection"]
}) {
  useUiLocale()
  // Seed once at mount: re-seeding on config change would clobber in-progress
  // edits whenever another section saves (each save reloads the shared config).
  const [httpProxy, setHttpProxy] = useState(() => config.http_proxy ?? "")
  const [httpsProxy, setHttpsProxy] = useState(() => config.https_proxy ?? "")
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<SectionMessage>(null)

  const save = async () => {
    setBusy(true)
    setMsg(null)
    try {
      await saveSection({ http_proxy: httpProxy.trim(), https_proxy: httpsProxy.trim() })
      setMsg({ kind: "ok", text: uiText("saved_1bd91a7d") })
    } catch (e) {
      setMsg({ kind: "error", text: getErrorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-2 rounded-lg border p-3">
      <div className="text-xs font-medium text-muted-foreground">{uiText("agent_5e84ea61")}</div>
      <div className="space-y-2">
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">{uiText("http_proxy_fe51a8c8")}</div>
          <Input
            placeholder="http://proxy.example.com:8080"
            value={httpProxy}
            onChange={(e) => setHttpProxy(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">{uiText("https_proxy_67047f31")}</div>
          <Input
            placeholder="https://proxy.example.com:8080"
            value={httpsProxy}
            onChange={(e) => setHttpsProxy(e.target.value)}
          />
        </div>
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
