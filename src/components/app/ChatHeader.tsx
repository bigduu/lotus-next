import { uiText, useUiLocale } from "@shared/i18n/ui"
import { type ReactNode } from "react"
import { Bot, Menu, Workflow } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useAppStore } from "@shared/store/appStore"
import { MachineTag } from "@/components/chat/MachineTag"
import { OverflowMenu } from "@/components/chat/OverflowMenu"
import { RightPanelLauncher } from "@/components/app/RightPanelLauncher"

type OverflowItem = { label: string; icon?: ReactNode; onClick: () => void }

export function ChatHeader({
  title,
  hasSession,
  overflowItems,
  onOpenSidebar,
  environment,
  sidePaneOpen,
  onToggleSidePane,
  onOpenSubagents,
  onOpenTaskDag,
  sidebarCollapsed,
  supervisorControl,
}: {
  title: string
  hasSession: boolean
  overflowItems: OverflowItem[]
  onOpenSidebar: () => void
  environment: ReactNode
  sidePaneOpen: boolean
  onToggleSidePane: () => void
  onOpenSubagents?: () => void
  onOpenTaskDag?: () => void
  /** Desktop: sidebar is collapsed, so show the menu button to bring it back. */
  sidebarCollapsed: boolean
  supervisorControl?: ReactNode
}) {
  useUiLocale()
  // Which machine the current session runs on — only badge non-local placements
  // (root sessions default to the backend's own host; that's noise here).
  const placement = useAppStore(
    useShallow((s) =>
      s.currentSessionId
        ? (s.chats.find((c) => c.id === s.currentSessionId)?.placement ?? null)
        : null,
    ),
  )

  return (
    <header className="flex items-center gap-2 px-4 py-2.5">
      <Button
        size="icon"
        variant="ghost"
        className={cn("md:hidden", sidebarCollapsed && "md:inline-flex")}
        aria-label={uiText("menu_4ce4cafd")}
        onClick={onOpenSidebar}
      >
        <Menu />
      </Button>
      <span className="flex-1 truncate text-sm font-medium">{title}</span>
      {placement && placement.kind !== "local" ? (
        <MachineTag placement={placement} compact className="max-w-36 shrink-0" />
      ) : null}
      <OverflowMenu items={overflowItems} />
      {supervisorControl}
      {hasSession ? (
        <>
          {environment}
          {onOpenTaskDag ? (
            <Button size="icon" variant="ghost" aria-label={uiText("session_task_dag_open")}
              title={uiText("session_task_dag_open")} onClick={onOpenTaskDag}>
              <Workflow />
            </Button>
          ) : null}
          {onOpenSubagents ? (
            <Button size="icon" variant="ghost" aria-label={uiText("open_subagent_tree")}
              title={uiText("open_subagent_tree")} onClick={onOpenSubagents}>
              <Bot />
            </Button>
          ) : null}
          <RightPanelLauncher open={sidePaneOpen} onToggle={onToggleSidePane} />
        </>
      ) : null}
    </header>
  )
}
