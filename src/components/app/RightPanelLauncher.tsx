import type { ReactNode } from "react"
import { ChevronRight, FileDiff, MessagesSquare, PanelRightOpen, SlidersHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"

function LauncherRow({
  icon,
  label,
  description,
  onClick,
}: {
  icon: ReactNode
  label: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onClick}
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block truncate text-xs text-muted-foreground">{description}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  )
}

export function RightPanelLauncher({
  open,
  controlsId,
  onToggle,
}: {
  open: boolean
  controlsId: string
  onToggle: () => void
}) {
  return (
    <Button
      size="icon"
      variant="ghost"
      aria-label={open ? "收起工作面板菜单" : "打开工作面板菜单"}
      aria-expanded={open}
      aria-controls={controlsId}
      onClick={onToggle}
    >
      <PanelRightOpen />
    </Button>
  )
}

export function RightPanelMenu({
  id,
  onOpenInspector,
  onOpenReview,
  onOpenSession,
}: {
  id: string
  onOpenInspector: () => void
  onOpenReview: () => void
  onOpenSession: () => void
}) {
  return (
    <nav
      id={id}
      aria-label="工作面板菜单"
      data-workbench-launcher-menu
      className="rounded-2xl border bg-popover p-2 text-popover-foreground shadow-lg"
      style={{ width: "min(18rem, 100%)" }}
    >
      <div className="px-3 pb-2 pt-1">
        <div className="text-sm font-semibold">工作面板</div>
        <div className="text-xs text-muted-foreground">选择要在右侧打开的内容</div>
      </div>
      <div className="space-y-1">
        <LauncherRow
          icon={<SlidersHorizontal className="size-4" />}
          label="检查器"
          description="目标、任务、子代理与运行信息"
          onClick={onOpenInspector}
        />
        <LauncherRow
          icon={<FileDiff className="size-4" />}
          label="Review"
          description="查看当前会话产生的文件变更"
          onClick={onOpenReview}
        />
        <LauncherRow
          icon={<MessagesSquare className="size-4" />}
          label="并排会话"
          description="在右侧查看另一个会话或子代理"
          onClick={onOpenSession}
        />
      </div>
    </nav>
  )
}
