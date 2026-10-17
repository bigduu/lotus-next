import { createContext, useContext } from "react"

export interface WorkbenchTabDrag {
  isActive: () => boolean
  cancel: () => void
}

export const WorkbenchTabDragContext = createContext<{ current: WorkbenchTabDrag | null } | null>(null)
export function useWorkbenchTabDrag() {
  const drag = useContext(WorkbenchTabDragContext)
  if (!drag) throw new Error("Workbench content requires its stable surface")
  return drag
}

