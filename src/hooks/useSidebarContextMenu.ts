import { useRef, useState, type KeyboardEvent, type MouseEvent } from "react"

/** Reuse a row's Radix action menu for pointer and keyboard context requests. */
export function useSidebarContextMenu(disabled = false) {
  const [open, setOpen] = useState(false)
  const returnFocus = useRef<HTMLElement | null>(null)
  const show = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => {
    // Preserve native editing/selection menus, including nested portalled menus.
    if (disabled || !event.currentTarget.contains(event.target as Node)) return
    const target = event.target as HTMLElement
    if (target.closest('input, textarea, [contenteditable="true"], [role="menu"]')) return
    event.preventDefault()
    event.stopPropagation()
    returnFocus.current = target.closest<HTMLElement>("button:not(:disabled), [tabindex]")
      ?? event.currentTarget.querySelector<HTMLElement>("button:not(:disabled), [tabindex]")
    setOpen(true)
  }
  return {
    open,
    onOpenChange: setOpen,
    rowProps: {
      onContextMenu: (event: MouseEvent<HTMLElement>) => show(event),
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) show(event)
      },
    },
    onCloseAutoFocus: (event: Event) => {
      if (returnFocus.current?.isConnected) {
        event.preventDefault()
        returnFocus.current.focus()
      }
      returnFocus.current = null
    },
  }
}
