import { useEffect, useState } from "react"
import { Trash2, Plus } from "lucide-react"
import { settingsService, type EnvVarResponse } from "@services/config/SettingsService"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"

export function SettingsEnv() {
  const [entries, setEntries] = useState<EnvVarResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState("")
  const [value, setValue] = useState("")
  const [secret, setSecret] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    settingsService
      .getEnvVars()
      .then((r) => setEntries(r.entries))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const add = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      const r = await settingsService.upsertEnvVar({ name: name.trim(), value, secret })
      setEntries(r.entries)
      setName("")
      setValue("")
      setSecret(false)
    } catch {
      /* ignore */
    } finally {
      setBusy(false)
    }
  }

  const remove = async (n: string) => {
    try {
      const r = await settingsService.deleteEnvVar(n)
      setEntries(r.entries)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        传递给后端 / 工具的环境变量。标记为密钥的值会在保存后被掩码显示。
      </p>

      <section className="space-y-2 rounded-lg border p-3">
        <div className="text-xs font-medium text-muted-foreground">新增变量</div>
        <Input placeholder="名称(如 OPENAI_API_KEY)" value={name} onChange={(e) => setName(e.target.value)} />
        <Input
          placeholder="值"
          type={secret ? "password" : "text"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <div className="flex items-center justify-between">
          <Label className="text-muted-foreground font-normal">
            <Switch checked={secret} onCheckedChange={setSecret} />
            密钥(掩码)
          </Label>
          <Button size="sm" onClick={add} disabled={!name.trim() || busy}>
            <Plus className="size-4" /> 添加
          </Button>
        </div>
      </section>

      <section className="rounded-lg border p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">已配置 ({entries.length})</div>
        {loading ? (
          <p className="text-xs text-muted-foreground">加载中…</p>
        ) : entries.length === 0 ? (
          <p className="text-xs text-muted-foreground">暂无</p>
        ) : (
          <ul className="space-y-1.5">
            {entries.map((e) => (
              <li key={e.name} className="flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-1.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-mono text-xs">{e.name}</span>
                    {e.secret ? (
                      <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">密钥</span>
                    ) : null}
                  </div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground">
                    {e.has_value ? e.value : <span className="italic">未设置</span>}
                  </div>
                </div>
                <button
                  onClick={() => void remove(e.name)}
                  aria-label="删除"
                  className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
