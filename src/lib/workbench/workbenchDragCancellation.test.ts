import { expect, it, vi } from "vitest"
import { Feedback, DragDropManager } from "@dnd-kit/dom"
import { workbenchDragCancellation } from "./workbenchDragCancellation"

it.each(["keydown", "pointerdown"])("keeps external cancellation animation disabled until the next %s pickup", (eventType) => {
  const manager = new DragDropManager()
  const feedback = manager.plugins.find((plugin) => plugin instanceof Feedback)!
  const previous = { duration: 123 }
  feedback.dropAnimation = previous
  let active = false
  const stop = vi.spyOn(manager.actions, "stop")
  const cancellation = workbenchDragCancellation(manager, () => active)
  cancellation.cancel()
  expect(stop).not.toHaveBeenCalled()
  expect(feedback.dropAnimation).toBe(previous)
  active = true
  cancellation.cancel()
  expect(stop).toHaveBeenCalledWith({ canceled: true })
  expect(feedback.dropAnimation).toBeNull()
  cancellation.cancel()
  expect(feedback.dropAnimation).toBeNull()
  manager.monitor.dispatch("beforedragstart", { operation: manager.dragOperation.snapshot(), nativeEvent: new Event(eventType), preventDefault: vi.fn(), defaultPrevented: false, cancelable: true })
  expect(feedback.dropAnimation).toBe(previous)
  cancellation.dispose()
  manager.destroy()
})
