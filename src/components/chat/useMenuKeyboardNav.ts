import { useEffect, useRef, useState } from "react"

/**
 * Keyboard navigation for composer-anchored pickers (SlashMenu / FileMenu):
 * ↑/↓ move the highlight, Enter or Tab picks the highlighted item, Escape
 * dismisses. Listens on window in CAPTURE phase so it wins over the composer
 * Textarea's own key handling while the textarea keeps focus (the menus are
 * input-driven and never focused themselves). Cmd/Ctrl+Enter is left alone —
 * that stays "send".
 */
export function useMenuKeyboardNav(
  count: number,
  onPickIndex: (index: number) => void,
  onDismiss?: () => void,
): number {
  const [active, setActive] = useState(0)
  const countRef = useRef(count)
  countRef.current = count
  const pickRef = useRef(onPickIndex)
  pickRef.current = onPickIndex
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss
  const activeRef = useRef(active)
  activeRef.current = active

  // Clamp the highlight when the filtered list shrinks.
  useEffect(() => {
    if (active >= count) setActive(count > 0 ? count - 1 : 0)
  }, [count, active])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (countRef.current === 0) return
      if (e.key === "ArrowDown") {
        e.preventDefault()
        e.stopPropagation()
        setActive((i) => (i + 1) % countRef.current)
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        e.stopPropagation()
        setActive((i) => (i - 1 + countRef.current) % countRef.current)
      } else if (
        (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.shiftKey) ||
        e.key === "Tab"
      ) {
        e.preventDefault()
        e.stopPropagation()
        pickRef.current(activeRef.current)
      } else if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        dismissRef.current?.()
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [])

  return active
}
