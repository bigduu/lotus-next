import { useEffect, useState } from "react"
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
  const [httpProxy, setHttpProxy] = useState("")
  const [httpsProxy, setHttpsProxy] = useState("")
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<SectionMessage>(null)

  useEffect(() => {
    setHttpProxy(config.http_proxy ?? "")
    setHttpsProxy(config.https_proxy ?? "")
  }, [config])

  const save = async () => {
    setBusy(true)
    setMsg(null)
    try {
      await saveSection({ http_proxy: httpProxy.trim(), https_proxy: httpsProxy.trim() })
      setMsg({ kind: "ok", text: "已保存" })
    } catch (e) {
      setMsg({ kind: "error", text: getErrorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-2 rounded-lg border p-3">
      <div className="text-xs font-medium text-muted-foreground">代理</div>
      <div className="space-y-2">
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">HTTP 代理</div>
          <Input
            placeholder="http://proxy.example.com:8080"
            value={httpProxy}
            onChange={(e) => setHttpProxy(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">HTTPS 代理</div>
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
          {busy ? "保存中…" : "保存"}
        </Button>
      </div>
    </section>
  )
}
