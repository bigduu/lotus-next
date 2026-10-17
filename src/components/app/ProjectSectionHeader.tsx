import type { ReactNode } from "react"
import { List, MoreHorizontal } from "lucide-react"
import { useUiText } from "@shared/i18n/ui"
import { useSidebarContextMenu } from "@/hooks/useSidebarContextMenu"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

/** Section actions use the same management dialog as the project menu. */
export function ProjectSectionHeader({ children, onManageSections }: {
  children: ReactNode
  onManageSections: () => void
}) {
  const uiText = useUiText()
  const menu = useSidebarContextMenu()
  return <div {...menu.rowProps} className="flex select-none items-center">
    {children}
    <DropdownMenu open={menu.open} onOpenChange={menu.onOpenChange}>
      <DropdownMenuTrigger aria-label={uiText("sidebar_manage_sections")}
        className="shrink-0 rounded p-1 text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
        <MoreHorizontal className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onCloseAutoFocus={menu.onCloseAutoFocus}>
        <DropdownMenuItem onSelect={onManageSections}>
          <List />{uiText("sidebar_manage_sections")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
}
