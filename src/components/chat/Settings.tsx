import { useEffect, useState } from "react"
import { X } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { useThemeStore } from "@shared/store/themeStore"
import { useAppStore } from "@shared/store/appStore"
import { metricsService } from "@services/metrics"
import type { MetricsSummary } from "@services/metrics/types"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-lg border p-2.5 text-center">
      <div className="text-lg font-semibold">{value ?? 0}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

export function Settings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const themeMode = useThemeStore((s) => s.themeMode)
  const setThemeMode = useThemeStore((s) => s.setThemeMode)
  const models = useAppStore(useShallow((s) => s.models))
  const selectedModel = useAppStore((s) => s.selectedModel)
  const setSelectedModel = useAppStore((s) => s.setSelectedModel)
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null)

  useEffect(() => {
    if (!open) return
    metricsService
      .getSummary()
      .then(setMetrics)
      .catch(() => setMetrics(null))
  }, [open])

  if (!open) return null

  return (
    <>
      <button className="fixed inset-0 z-40 bg-black/50" aria-label="关闭设置" onClick={onClose} />
      <aside
        className={cn(
          "fixed z-50 flex flex-col bg-card",
          "inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl border-t",
          "md:inset-y-0 md:right-0 md:left-auto md:w-96 md:max-h-none md:rounded-none md:border-l md:border-t-0",
        )}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-semibold">系统设置</span>
          <Button size="icon" variant="ghost" onClick={onClose}>
            <X />
          </Button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <section className="rounded-lg border p-3">
            <div className="mb-2 text-xs font-medium text-muted-foreground">外观</div>
            <div className="flex gap-2">
              {(["light", "dark"] as const).map((m) => (
                <Button
                  key={m}
                  variant={themeMode === m ? "default" : "secondary"}
                  className="flex-1"
                  onClick={() => setThemeMode(m)}
                >
                  {m === "light" ? "浅色" : "深色"}
                </Button>
              ))}
            </div>
          </section>

          <section className="rounded-lg border p-3">
            <div className="mb-2 text-xs font-medium text-muted-foreground">默认模型</div>
            {models.length === 0 ? (
              <p className="text-xs text-muted-foreground">模型列表加载中或为空</p>
            ) : (
              <select
                value={selectedModel ?? ""}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="" disabled>
                  选择模型
                </option>
                {models.map((m) => (
                  <option key={m} value={m} className="bg-card">
                    {m}
                  </option>
                ))}
              </select>
            )}
          </section>

          <section className="rounded-lg border p-3">
            <div className="mb-2 text-xs font-medium text-muted-foreground">用量统计</div>
            {metrics ? (
              <div className="grid grid-cols-3 gap-2">
                <Stat label="总会话" value={metrics.total_sessions} />
                <Stat label="进行中" value={metrics.active_sessions} />
                <Stat label="已完成" value={metrics.completed_sessions} />
                <Stat label="工具调用" value={metrics.total_tool_calls} />
                <Stat label="出错" value={metrics.error_sessions} />
                <Stat label="压缩节省" value={metrics.total_tokens_saved} />
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">加载中…</p>
            )}
          </section>

          <section className="rounded-lg border p-3">
            <div className="mb-2 text-xs font-medium text-muted-foreground">关于</div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">应用</span>
              <span className="font-medium">Bodhi · lotus-next</span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              更多配置(提供方、环境变量、MCP、权限等)可在后端 / 桌面端设置中管理。
            </p>
          </section>
        </div>
      </aside>
    </>
  )
}
