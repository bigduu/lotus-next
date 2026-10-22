import { useCallback, useLayoutEffect, useRef, useState } from "react"
import { copyText } from "@shared/utils/clipboard"

type CopyFeedback = { status: "idle" | "copied" | "error"; sequence: number }

const IDLE: CopyFeedback = { status: "idle", sequence: 0 }

/** Transient feedback belongs to the current source, not an outstanding write. */
export function useCopyFeedback(text: string, sourceId: string) {
  const [feedback, setFeedback] = useState<CopyFeedback>(IDLE)
  const lifecycle = useRef({ active: false, generation: 0, request: 0, sequence: 0, text, sourceId })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }, [])

  useLayoutEffect(() => {
    const current = lifecycle.current
    current.active = true
    current.generation += 1
    current.text = text
    current.sourceId = sourceId
    setFeedback((previous) => previous.status === "idle" ? previous : IDLE)
    return () => {
      current.active = false
      current.generation += 1
      clearTimer()
    }
  }, [text, sourceId, clearTimer])

  const copy = useCallback(async () => {
    const current = lifecycle.current
    if (!current.active || current.text !== text || current.sourceId !== sourceId) return
    const generation = current.generation
    const request = ++current.request
    const isCurrent = () => current.active
      && current.generation === generation && current.request === request

    setFeedback((previous) => previous.status === "error" ? IDLE : previous)
    try {
      // Preserve Markdown, whitespace and CJK verbatim; never copy rendered DOM.
      await copyText(text)
    } catch {
      if (!isCurrent()) return
      clearTimer()
      setFeedback({ status: "error", sequence: current.sequence })
      return
    }
    if (!isCurrent()) return

    clearTimer()
    const sequence = ++current.sequence
    setFeedback({ status: "copied", sequence })
    timer.current = setTimeout(() => {
      // A newer pending request must not extend an earlier success receipt.
      if (current.active && current.generation === generation && current.sequence === sequence) {
        timer.current = null
        setFeedback(IDLE)
      }
    }, 2500)
  }, [text, sourceId, clearTimer])

  return { ...feedback, copy }
}
