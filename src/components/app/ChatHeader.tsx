import { type ReactNode } from "react"
import { Menu } from "lucide-react"
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
  workbenchMenuOpen,
  workbenchMenuId,
  onToggleWorkbenchMenu,
  sidebarCollapsed,
}: {
  title: string
  hasSession: boolean
  overflowItems: OverflowItem[]
  onOpenSidebar: () => void
  workbenchMenuOpen: boolean
  workbenchMenuId: string
  onToggleWorkbenchMenu: () => void
  /** Desktop: sidebar is collapsed, so show the menu button to bring it back. */
  sidebarCollapsed: boolean
}) {
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
    <header className="flex items-center gap-2 border-b px-3 py-2.5">
      <Button
        size="icon"
        variant="ghost"
        className={cn("md:hidden", sidebarCollapsed && "md:inline-flex")}
        aria-label="菜单"
        onClick={onOpenSidebar}
      >
        <Menu />
      </Button>
      <span className="flex-1 truncate text-sm font-semibold">{title}</span>
      {placement && placement.kind !== "local" ? (
        <MachineTag placement={placement} compact className="max-w-36 shrink-0" />
      ) : null}
      <OverflowMenu items={overflowItems} />
      {hasSession ? (
        <RightPanelLauncher
          open={workbenchMenuOpen}
          controlsId={workbenchMenuId}
          onToggle={onToggleWorkbenchMenu}
        />
      ) : null}
    </header>
  )
}
