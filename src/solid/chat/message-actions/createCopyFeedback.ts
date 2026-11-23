import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from "solid-js"
import { copyText } from "@shared/utils/clipboard"

type Feedback = { status: "idle" | "copied" | "error"; sequence: number }
const IDLE: Feedback = { status: "idle", sequence: 0 }

export function createCopyFeedback(text: Accessor<string>, source: Accessor<string>) {
  const identity = createMemo(() => ({ text: text(), source: source() }), {
    equals: (before, after) => before?.source === after.source && before?.text === after.text,
  })
  const [feedback, setFeedback] = createSignal<Feedback>(IDLE)
  let mounted = true
  let request = 0
  let sequence = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const clearTimer = () => {
    clearTimeout(timer)
    timer = undefined
  }
  createEffect(identity, () => {
    clearTimer()
    setFeedback(IDLE)
  })
  onCleanup(() => {
    mounted = false
    clearTimer()
  })

  const boundCopy = createMemo(() => {
    const origin = identity()
    return async () => {
      if (!mounted || identity() !== origin) return
      const token = ++request
      const owns = () => mounted && identity() === origin && request === token
      setFeedback((current) => current.status === "error" ? IDLE : current)
      try {
        await copyText(origin.text)
      } catch {
        if (!owns()) return
        clearTimer()
        setFeedback({ status: "error", sequence })
        return
      }
      if (!owns()) return
      clearTimer()
      const completion = ++sequence
      setFeedback({ status: "copied", sequence: completion })
      timer = setTimeout(() => {
        if (mounted && identity() === origin && sequence === completion) setFeedback(IDLE)
      }, 2500)
    }
  })

  return { feedback, get copy() { return boundCopy() } }
}
