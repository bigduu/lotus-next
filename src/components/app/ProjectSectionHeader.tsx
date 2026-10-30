import type { ReactNode } from "react"
import { List, MessageSquarePlus, MoreHorizontal, SquarePen } from "lucide-react"
import { useUiText } from "@shared/i18n/ui"
import { useSidebarContextMenu } from "@/hooks/useSidebarContextMenu"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

/** Section actions use the same management dialog as the project menu. */
export function ProjectSectionHeader({
  children,
  sectionName,
  onNewSession,
  onManageSections,
}: {
  children: ReactNode
  /** Section display name for action labels; omit to hide new-session entries. */
  sectionName?: string
  onNewSession?: () => void
  onManageSections: () => void
}) {
  const uiText = useUiText()
  const menu = useSidebarContextMenu()
  const canCreate = !!sectionName && !!onNewSession
  return <div {...menu.rowProps} className="flex select-none items-center">
    {children}
    {canCreate ? (
      <button
        type="button"
        aria-label={uiText("sidebar_section_new_session", { v0: sectionName })}
        className="shrink-0 rounded p-1 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onNewSession}
      >
        <SquarePen className="size-3.5" />
      </button>
    ) : null}
    <DropdownMenu open={menu.open} onOpenChange={menu.onOpenChange}>
      <DropdownMenuTrigger aria-label={uiText("sidebar_manage_sections")}
        className="shrink-0 rounded p-1 text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
        <MoreHorizontal className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onCloseAutoFocus={menu.onCloseAutoFocus}>
        {canCreate ? (
          <DropdownMenuItem onSelect={onNewSession}>
            <MessageSquarePlus />{uiText("sidebar_section_new_session", { v0: sectionName })}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={onManageSections}>
          <List />{uiText("sidebar_manage_sections")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
}
