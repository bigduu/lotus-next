import { useEffect, useState } from "react"
import { X } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { useThemeStore } from "@shared/store/themeStore"
import { useAppStore } from "@shared/store/appStore"
import { useProviderStore } from "@shared/store/appStore/slices/providerSlice"
import { metricsService } from "@services/metrics"
import type { MetricsSummary } from "@services/metrics/types"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"
import { cn } from "@/lib/utils"
import { SettingsProviders } from "@/components/chat/settings/SettingsProviders"
import { SettingsMcp } from "@/components/chat/settings/SettingsMcp"
import { SettingsSkills } from "@/components/chat/settings/SettingsSkills"
import { SettingsPermissions } from "@/components/chat/settings/SettingsPermissions"
import { SettingsEnv } from "@/components/chat/settings/SettingsEnv"
import { SettingsSchedules } from "@/components/chat/settings/SettingsSchedules"
import { SettingsNotifications } from "@/components/chat/settings/SettingsNotifications"
import { SettingsMasking } from "@/components/chat/settings/SettingsMasking"

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-lg border p-2.5 text-center">
      <div className="text-lg font-semibold">{value ?? 0}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

function GeneralTab() {
  const themeMode = useThemeStore((s) => s.themeMode)
  const setThemeMode = useThemeStore((s) => s.setThemeMode)
  const models = useAppStore(useShallow((s) => s.models))
  const selectedModel = useAppStore((s) => s.selectedModel)
  const setSelectedModel = useAppStore((s) => s.setSelectedModel)
  const defaultChatModel = useProviderStore((s) => s.providerConfig?.defaults?.chat?.model)
  const activeModel = selectedModel || defaultChatModel || ""
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null)

  useEffect(() => {
    metricsService
      .getSummary()
      .then(setMetrics)
      .catch(() => setMetrics(null))
  }, [])

  return (
    <div className="space-y-4">
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
          <Select value={activeModel} onValueChange={setSelectedModel}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="选择模型" />
            </SelectTrigger>
            <SelectContent>
              {activeModel && !models.includes(activeModel) ? (
                <SelectItem value={activeModel}>{activeModel}</SelectItem>
              ) : null}
              {models.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
      </section>
    </div>
  )
}

const TABS = [
  { id: "general", label: "通用", render: () => <GeneralTab /> },
  { id: "providers", label: "提供方", render: () => <SettingsProviders /> },
  { id: "mcp", label: "MCP", render: () => <SettingsMcp /> },
  { id: "skills", label: "技能", render: () => <SettingsSkills /> },
  { id: "permissions", label: "权限", render: () => <SettingsPermissions /> },
  { id: "env", label: "环境变量", render: () => <SettingsEnv /> },
  { id: "schedules", label: "定时任务", render: () => <SettingsSchedules /> },
  { id: "notifications", label: "通知", render: () => <SettingsNotifications /> },
  { id: "masking", label: "关键词掩码", render: () => <SettingsMasking /> },
] as const

export function Settings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("general")
  if (!open) return null
  const current = TABS.find((t) => t.id === tab) ?? TABS[0]

  return (
    <ResponsiveDialog
      open
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <ResponsiveDialogContent
        showCloseButton={false}
        className="h-[88dvh] p-0 sm:h-[80vh] sm:max-w-3xl"
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <ResponsiveDialogTitle>系统设置</ResponsiveDialogTitle>
          <Button size="icon" variant="ghost" onClick={onClose}>
            <X />
          </Button>
        </div>

        {/* Tab rail (left on desktop, horizontal scroll on mobile) */}
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="flex shrink-0 gap-1 overflow-x-auto border-b p-2 md:w-40 md:flex-col md:overflow-y-auto md:border-b-0 md:border-r">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm transition-colors md:w-full",
                  tab === t.id
                    ? "bg-accent font-medium text-foreground"
                    : "text-muted-foreground hover:bg-accent/60",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">{current.render()}</div>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
