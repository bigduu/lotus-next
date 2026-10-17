import { Feedback } from "@dnd-kit/dom"
import type { DragDropManager } from "@dnd-kit/react"

/** External navigation owns focus; an old drop animation must not reclaim it. */
export function workbenchDragCancellation(manager: DragDropManager, isActive: () => boolean) {
  const feedback = manager.plugins.find((plugin) => plugin instanceof Feedback)
  let restoreAnimation: (() => void) | undefined
  const unsubscribe = manager.monitor.addEventListener("beforedragstart", () => {
    restoreAnimation?.()
    restoreAnimation = undefined
  })
  return {
    cancel() {
      if (!isActive()) return
      if (feedback && !restoreAnimation) {
        const previous = feedback.dropAnimation
        restoreAnimation = () => { feedback.dropAnimation = previous }
        // stop() finishes rendering asynchronously. Keep this override until the
        // next pickup, so that cleanup cannot schedule a late handle.focus().
        feedback.dropAnimation = null
      }
      manager.actions.stop({ canceled: true })
    },
    dispose: unsubscribe,
  }
}
