import { createEffect, createMemo } from "solid-js"
import type { ChatItem } from "@shared/types/chatMessages"

const animationClass = "session-title-arrival"

export function createSessionTitleMotion(read: () => ChatItem | undefined, visible: () => boolean) {
  let element: HTMLElement | undefined
  const title = createMemo(() => {
    const chat = read()
    return { id: chat?.id, title: chat?.title, version: chat?.titleMotionVersion }
  }, { equals: (a, b) => a.id === b.id && a.title === b.title && a.version === b.version })
  createEffect(title, (current, previous) => {
    const target = element
    if (!target || !previous || (current.id === previous.id && current.title === previous.title)) return
    if (current.id !== previous.id || current.version === undefined || current.version === previous.version || !visible()) return
    const document = target.ownerDocument
    const view = document.defaultView
    if (!view || document.hidden || document.body.dataset.vdiSafe === "true" || target.closest("[inert]")
      || view.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return
    const { top, right, bottom, left } = target.getBoundingClientRect()
    if (bottom <= 0 || right <= 0 || top >= view.innerHeight || left >= view.innerWidth) return
    const finish = (event: AnimationEvent) => {
      if (event.target === target && event.animationName === animationClass) target.classList.remove(animationClass)
    }
    target.addEventListener("animationend", finish)
    target.addEventListener("animationcancel", finish)
    target.classList.add(animationClass)
    return () => {
      target.removeEventListener("animationend", finish)
      target.removeEventListener("animationcancel", finish)
      target.classList.remove(animationClass)
    }
  })
  return (target: HTMLElement) => { element = target }
}
