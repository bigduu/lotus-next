import { KeyboardSensor, PointerSensor } from "@dnd-kit/react"

// DnD 0.5's sensors remove their listeners on their own end gesture, but an
// external manager.actions.stop() does not run that cleanup. Global dialogs and
// navigation must release those listeners too, not just reset the drag state.
class WorkbenchKeyboardSensor extends KeyboardSensor {
  private readonly unsubscribe: () => void
  constructor(...args: ConstructorParameters<typeof KeyboardSensor>) {
    super(...args)
    this.unsubscribe = this.manager.monitor.addEventListener("dragend", () => this.cleanup())
  }
  override destroy() {
    this.unsubscribe()
    super.destroy()
  }
}

class WorkbenchPointerSensor extends PointerSensor {
  private readonly unsubscribe: () => void
  constructor(...args: ConstructorParameters<typeof PointerSensor>) {
    super(...args)
    this.unsubscribe = this.manager.monitor.addEventListener("dragend", () => this.cleanup())
  }
  override destroy() {
    this.unsubscribe()
    super.destroy()
  }
}

export const workbenchSensors = [WorkbenchPointerSensor, WorkbenchKeyboardSensor]
