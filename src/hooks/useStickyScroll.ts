import { useEffect, useRef, useState } from "react"

/**
 * Keeps a scroll container pinned to the latest message.
 *
 * A ResizeObserver on the content catches EVERY height change — streaming
 * growth, the streaming→markdown swap, and async (lazy) markdown layout — and
 * re-pins to the bottom whenever the user is already there. Opening a session
 * re-pins. `pinToBottom()` is called on send so the reply grows pinned.
 *
 * The three refs + their effects are intentionally one cohesive unit: splitting
 * them across components breaks pinning (the audit's note on this seam).
 */
export function useStickyScroll(currentSessionId: string | null | undefined) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const [atBottom, setAtBottom] = useState(true)

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    stickRef.current = near
    setAtBottom(near)
  }

  const scrollToBottom = () => {
    const el = scrollRef.current
    if (!el) return
    stickRef.current = true
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
  }

  /** Re-pin to the bottom (e.g. right after sending a message). */
  const pinToBottom = () => {
    stickRef.current = true
  }

  useEffect(() => {
    const content = contentRef.current
    const el = scrollRef.current
    if (!content || !el) return
    const ro = new ResizeObserver(() => {
      if (stickRef.current) el.scrollTo({ top: el.scrollHeight })
    })
    ro.observe(content)
    return () => ro.disconnect()
  }, [])

  // Opening a session re-pins to the bottom.
  useEffect(() => {
    stickRef.current = true
    const el = scrollRef.current
    if (el) requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight }))
  }, [currentSessionId])

  return { scrollRef, contentRef, atBottom, handleScroll, scrollToBottom, pinToBottom }
}
