import { useEffect, useState } from "react"
import { Trash2, Plus } from "lucide-react"
import { serviceFactory } from "@services/common/ServiceFactory"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type Entry = { pattern: string; match_type: string; enabled: boolean }

const MATCH_TYPES = ["exact", "contains", "regex"]
const input =
  "rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"

export function SettingsMasking() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [pattern, setPattern] = useState("")
  const [matchType, setMatchType] = useState("exact")

  useEffect(() => {
    serviceFactory
      .getKeywordMaskingConfig()
      .then((r) => setEntries(r.entries))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const save = async (next: Entry[]) => {
    setEntries(next)
    try {
      const r = await serviceFactory.updateKeywordMaskingConfig(next)
      setEntries(r.entries)
    } catch {
      /* ignore */
    }
  }

  const add = () => {
    if (!pattern.trim()) return
    void save([...entries, { pattern: pattern.trim(), match_type: matchType, enabled: true }])
    setPattern("")
  }

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-muted-foreground">
        匹配的内容会在发往模型 / 日志前被掩码,避免密钥等敏感信息外泄。
      </p>

      <section className="space-y-2 rounded-lg border p-3">
        <div className="text-xs font-medium text-muted-foreground">新增规则</div>
        <div className="flex gap-2">
          <input
            className={cn(input, "flex-1")}
            placeholder="要掩码的内容 / 模式"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add()
            }}
          />
          <select className={input} value={matchType} onChange={(e) => setMatchType(e.target.value)}>
            {MATCH_TYPES.map((t) => (
              <option key={t} value={t} className="bg-card">
                {t}
              </option>
            ))}
          </select>
          <Button size="sm" onClick={add} disabled={!pattern.trim()}>
            <Plus className="size-4" />
          </Button>
        </div>
      </section>

      <section className="rounded-lg border p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">掩码规则 ({entries.length})</div>
        {loading ? (
          <p className="text-xs text-muted-foreground">加载中…</p>
        ) : entries.length === 0 ? (
          <p className="text-xs text-muted-foreground">暂无</p>
        ) : (
          <ul className="space-y-1.5">
            {entries.map((e, i) => (
              <li key={`${e.pattern}-${i}`} className="flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-1.5">
                <input
                  type="checkbox"
                  checked={e.enabled}
                  onChange={() =>
                    void save(entries.map((x, j) => (j === i ? { ...x, enabled: !x.enabled } : x)))
                  }
                />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{e.pattern}</span>
                <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                  {e.match_type}
                </span>
                <button
                  onClick={() => void save(entries.filter((_, j) => j !== i))}
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
