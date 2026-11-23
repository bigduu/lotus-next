import { createEffect, createSignal } from "solid-js"
import type { ChatItem } from "@shared/types/chatMessages"
import { SIDEBAR_SESSION_DRAG_TYPE } from "@/lib/projectSidebarPreferences"
import { readSessionDrag } from "@/lib/sessionDrag"

export function createSessionDrop(chats: () => readonly ChatItem[], onOpen: (id: string) => void) {
  const [target, bindTarget] = createSignal<HTMLElement>()
  const [active, setActive] = createSignal(false)
  const clear = () => setActive(false)

  createEffect(target, (element) => {
    if (!element) return
    const accepts = (transfer: DataTransfer | null): transfer is DataTransfer => Boolean(transfer
      && transfer.types.includes(SIDEBAR_SESSION_DRAG_TYPE) && !transfer.types.includes("Files"))
    const dragover = (event: DragEvent) => {
      if (!accepts(event.dataTransfer)) return
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = "copy"
      setActive(true)
    }
    const dragleave = (event: DragEvent) => {
      if (!(event.relatedTarget instanceof Node) || !element.contains(event.relatedTarget)) clear()
    }
    const drop = (event: DragEvent) => {
      clear()
      if (!accepts(event.dataTransfer)) return
      event.preventDefault()
      event.stopPropagation()
      const payload = readSessionDrag(event.dataTransfer)
      if (!payload) return
      const session = chats().find((chat) => chat.id === payload.sessionId)
      if (!session || session.parentSessionId || (session.kind && session.kind !== "root")) return
      if ((session.config?.projectId?.trim() || null) === payload.projectId) onOpen(session.id)
    }

    element.addEventListener("dragover", dragover, true)
    element.addEventListener("dragleave", dragleave, true)
    element.addEventListener("drop", drop, true)
    window.addEventListener("dragend", clear)
    window.addEventListener("drop", clear)
    return () => {
      element.removeEventListener("dragover", dragover, true)
      element.removeEventListener("dragleave", dragleave, true)
      element.removeEventListener("drop", drop, true)
      window.removeEventListener("dragend", clear)
      window.removeEventListener("drop", clear)
    }
  })
  return { active, bindTarget }
}
