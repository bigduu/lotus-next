import {
  lazy,
  Suspense,
  useState,
  type ComponentType,
} from "react"
import { X } from "lucide-react"
import { ErrorBoundary } from "@/components/app/ErrorBoundary"
import { Button } from "@/components/ui/button"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"
import type { SettingsTabId } from "./Settings"

export interface SettingsProps {
  open: boolean
  onClose: () => void
  /** Test seam; production always uses the canonical Settings module. */
  loadSettings?: SettingsLoader
}

export interface SettingsModule {
  SettingsContent: ComponentType<SettingsContentProps>
}

export type SettingsLoader = () => Promise<SettingsModule>

export interface SettingsContentProps {
  tab: SettingsTabId
  onTabChange: (tab: SettingsTabId) => void
}

function SettingsLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-0 flex-1 items-center justify-center p-6 text-sm text-muted-foreground"
    >
      正在加载设置…
    </div>
  )
}

function SettingsLoadFailure({ onClose }: { onClose: () => void }) {
  return (
    <div
      role="alert"
      className="flex min-h-0 flex-1 flex-col items-center justify-center p-6 text-center"
    >
      <div className="text-base font-semibold">设置加载失败</div>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
        设置代码未能加载，聊天仍可继续使用。请返回聊天并刷新页面后重试。
      </p>
      <Button className="mt-4" onClick={onClose}>
        返回聊天
      </Button>
    </div>
  )
}

const defaultLoadSettings: SettingsLoader = () => import("./Settings")

/** The single stable, responsive shell around the lazy Settings feature. */
export function LazySettings({
  open,
  onClose,
  loadSettings = defaultLoadSettings,
}: SettingsProps) {
  // Both owners are initialized once for this boundary instance. Closing the
  // Radix content preserves the accepted tab while the lazy type stays cached.
  const [tab, setTab] = useState<SettingsTabId>("general")
  const [SettingsFeature] = useState(() =>
    lazy(async () => {
      const loaded = await loadSettings()
      return { default: loaded.SettingsContent }
    }),
  )
  if (!open) return null

  return (
    <ResponsiveDialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose()
      }}
    >
      <ResponsiveDialogContent
        showCloseButton={false}
        className="h-[88dvh] p-0 sm:h-[80vh] sm:max-w-3xl"
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <ResponsiveDialogTitle>系统设置</ResponsiveDialogTitle>
          <Button
            aria-label="关闭设置"
            size="icon"
            variant="ghost"
            onClick={onClose}
          >
            <X />
          </Button>
        </div>
        <ErrorBoundary
          name="Settings"
          fallback={<SettingsLoadFailure onClose={onClose} />}
        >
          <Suspense fallback={<SettingsLoading />}>
            <SettingsFeature tab={tab} onTabChange={setTab} />
          </Suspense>
        </ErrorBoundary>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
