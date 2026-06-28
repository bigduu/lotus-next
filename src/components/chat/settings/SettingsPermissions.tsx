import { useEffect, useState } from "react"
import { Trash2, Plus } from "lucide-react"
import { settingsService } from "@services/config/SettingsService"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function SettingsPermissions() {
  const [rules, setRules] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState("")

  useEffect(() => {
    settingsService
      .getPermissionAskRules()
      .then(setRules)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const save = async (next: string[]) => {
    setRules(next)
    try {
      const saved = await settingsService.updatePermissionAskRules(next)
      setRules(saved)
    } catch {
      /* ignore */
    }
  }

  const add = () => {
    const r = draft.trim()
    if (!r || rules.includes(r)) return
    void save([...rules, r])
    setDraft("")
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        匹配这些规则的工具调用会在执行前弹出审批。规则可以是工具名或模式(如 <code>Bash</code>、<code>write_file</code>)。
      </p>

      <section className="space-y-2 rounded-lg border p-3">
        <div className="text-xs font-medium text-muted-foreground">新增规则</div>
        <div className="flex gap-2">
          <Input
            className="flex-1"
            placeholder="工具名 / 模式"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add()
            }}
          />
          <Button size="sm" onClick={add} disabled={!draft.trim()}>
            <Plus className="size-4" /> 添加
          </Button>
        </div>
      </section>

      <section className="rounded-lg border p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">需审批的规则 ({rules.length})</div>
        {loading ? (
          <p className="text-xs text-muted-foreground">加载中…</p>
        ) : rules.length === 0 ? (
          <p className="text-xs text-muted-foreground">暂无 —— 所有工具直接执行</p>
        ) : (
          <ul className="space-y-1.5">
            {rules.map((r) => (
              <li key={r} className="flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-1.5">
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{r}</span>
                <button
                  onClick={() => void save(rules.filter((x) => x !== r))}
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
