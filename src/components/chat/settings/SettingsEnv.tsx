import { useCallback, useEffect, useState } from "react"
import { Trash2, Plus } from "lucide-react"
import { settingsService, type EnvVarResponse } from "@services/config/SettingsService"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"

export function SettingsEnv() {
  const [entries, setEntries] = useState<EnvVarResponse[]>([])
  const [revision, setRevision] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState("")
  const [value, setValue] = useState("")
  const [secret, setSecret] = useState(false)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const applySnapshot = useCallback((snapshot: { entries: EnvVarResponse[]; revision: number }) => {
    setEntries(snapshot.entries)
    setRevision(snapshot.revision)
  }, [])

  const reload = useCallback(async () => {
    try {
      const snapshot = await settingsService.getEnvVars()
      applySnapshot(snapshot)
      setError(null)
      return true
    } catch {
      setRevision(null)
      setError("无法确认当前环境变量列表，请刷新设置后重试。错误详情已隐藏。")
      return false
    }
  }, [applySnapshot])

  useEffect(() => {
    void reload().finally(() => setLoading(false))
  }, [reload])

  const add = async () => {
    if (!name.trim() || revision === null || busy) return
    setBusy(true)
    setError(null)
    try {
      const snapshot = await settingsService.upsertEnvVar(
        { name: name.trim(), value, secret },
        revision,
      )
      applySnapshot(snapshot)
      setName("")
      setValue("")
      setSecret(false)
    } catch {
      const refreshed = await reload()
      setError(
        refreshed
          ? "添加结果未确认，已刷新实际列表；请核对后重试。错误详情已隐藏。"
          : "添加失败，且无法刷新实际列表；请稍后重试。错误详情已隐藏。",
      )
    } finally {
      setBusy(false)
    }
  }

  const remove = async (n: string) => {
    if (revision === null || deleting !== null) return
    setDeleting(n)
    setError(null)
    try {
      const snapshot = await settingsService.deleteEnvVar(n, revision)
      applySnapshot(snapshot)
    } catch {
      const refreshed = await reload()
      setError(
        refreshed
          ? "删除结果未确认，已刷新实际列表；请核对后重试。错误详情已隐藏。"
          : "删除失败，且无法刷新实际列表；请稍后重试。错误详情已隐藏。",
      )
    } finally {
      setDeleting(null)
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
          <Button size="sm" onClick={add} disabled={!name.trim() || revision === null || busy}>
            <Plus className="size-4" /> {busy ? "添加中…" : "添加"}
          </Button>
        </div>
      </section>

      {error ? (
        <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}

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
                    {e.has_value ? (
                      e.secret ? "已设置（值已隐藏）" : e.value
                    ) : (
                      <span className="italic">未设置</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => void remove(e.name)}
                  disabled={deleting !== null || revision === null}
                  aria-label={`删除 ${e.name}`}
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
