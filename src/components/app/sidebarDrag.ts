import type { ComponentType, HTMLAttributes, ReactNode } from "react"
import type { SidebarDragPickup, SidebarDragSource, SidebarDragState, SidebarDropTarget } from "@/lib/workbench/sidebarDrag"

export type SidebarDragParts = {
  Handle: ComponentType<{ source: SidebarDragSource; label: string; disabled?: boolean }>
  Target: ComponentType<HTMLAttributes<HTMLDivElement> & { target: SidebarDropTarget; disabled?: boolean; children: ReactNode }>
}

export type SidebarProjectDragProps = SidebarDragState & {
  scopeKey: string
  /**
   * `after` only applies to a row target: true means "place below that row".
   * A bucket target ignores it.
   */
  onMoveSession: (pickup: SidebarDragPickup, target: SidebarDropTarget, after?: boolean) => Promise<boolean>
  onMoveSection: (pickup: SidebarDragPickup, target: SidebarDropTarget, after: boolean) => void
  children: (parts?: SidebarDragParts) => ReactNode
}
