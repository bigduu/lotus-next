import { createSignal } from "solid-js"

type ContextEvent = (MouseEvent | KeyboardEvent) & { currentTarget: HTMLDivElement }

export function createSidebarContextMenu(enabled = () => true) {
  const [open, setOpen] = createSignal(false)
  let trigger: HTMLButtonElement | undefined
  let origin: HTMLElement | undefined

  const show = (event: ContextEvent) => {
    const target = event.target
    if (!enabled() || !(target instanceof Element) || !event.currentTarget.contains(target)
      || target.closest('input, textarea, [contenteditable="true"], [role="menu"]')) return
    event.preventDefault()
    event.stopPropagation()
    origin = target.closest<HTMLElement>("button:not(:disabled), [tabindex]")
      ?? event.currentTarget.querySelector<HTMLElement>("button:not(:disabled), [tabindex]") ?? undefined
    setOpen(true)
  }

  const restoreFocus = () => {
    const previous = origin
    origin = undefined
    queueMicrotask(() => {
      const active = document.activeElement
      if (previous?.isConnected && (active === trigger || active === document.body)) {
        previous.focus({ preventScroll: true })
      }
    })
  }

  return {
    open,
    setOpen,
    triggerRef: (element: HTMLButtonElement) => { trigger = element },
    onContextMenu: show,
    onKeyDown: (event: KeyboardEvent & { currentTarget: HTMLDivElement }) => {
      if (!event.isComposing && (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) show(event)
    },
    restoreFocus,
  }
}
