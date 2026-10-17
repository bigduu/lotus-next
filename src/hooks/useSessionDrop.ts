import { useEffect, useState, type DragEvent } from "react"
import { SIDEBAR_SESSION_DRAG_TYPE } from "@/lib/projectSidebarPreferences"
import { readSessionDrag } from "@/lib/sessionDrag"

type Session = { id: string; parentSessionId?: string | null; kind?: string; config?: { projectId?: string | null } }

/** Capture session drops before an editor can insert their native drag content. */
export function useSessionDrop(chats: readonly Session[], onOpen: (id: string) => void) {
  const [active, setActive] = useState(false)
  useEffect(() => {
    const clear = () => setActive(false)
    window.addEventListener("dragend", clear)
    window.addEventListener("drop", clear)
    return () => {
      window.removeEventListener("dragend", clear)
      window.removeEventListener("drop", clear)
    }
  }, [])
  const accepts = (event: DragEvent<HTMLElement>) => event.dataTransfer.types.includes(SIDEBAR_SESSION_DRAG_TYPE)
    && !event.dataTransfer.types.includes("Files")
  return {
    active,
    handlers: {
      onDragOverCapture: (event: DragEvent<HTMLElement>) => {
        if (!accepts(event)) return
        event.preventDefault()
        event.stopPropagation()
        event.dataTransfer.dropEffect = "copy"
        setActive(true)
      },
      onDragLeaveCapture: (event: DragEvent<HTMLElement>) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setActive(false)
      },
      onDropCapture: (event: DragEvent<HTMLElement>) => {
        setActive(false)
        if (!accepts(event)) return
        event.preventDefault()
        event.stopPropagation()
        const payload = readSessionDrag(event.dataTransfer)
        if (!payload) return
        const session = chats.find((item) => item.id === payload.sessionId)
        // Only sidebar roots in the current backend index are navigable. Never
        // trust a foreign/forged project identity or create a missing session.
        if (!session || session.parentSessionId || (session.kind && session.kind !== "root")) return
        if ((session.config?.projectId?.trim() || null) !== payload.projectId) return
        onOpen(session.id)
      },
    },
  }
}
