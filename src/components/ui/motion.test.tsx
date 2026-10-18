import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { Button } from "./button"
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./dropdown-menu"
import { feedbackMotion, surfaceMotion } from "./motion"
import { Switch } from "./switch"
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogTitle, ResponsiveDialogDescription } from "./responsive-dialog"

let root: Root
let container: HTMLDivElement
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
beforeAll(() => { actEnvironment.IS_REACT_ACT_ENVIRONMENT = true })
afterAll(() => { Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT") })
afterEach(() => {
  act(() => root?.unmount())
  document.body.replaceChildren()
})

function mount(element: React.ReactNode) {
  container = document.body.appendChild(document.createElement("div"))
  root = createRoot(container)
  act(() => root.render(element))
}

function key(element: Element, value: string) {
  act(() => element.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true })))
}

function expectSurfaceMotion(element: Element) {
  for (const token of surfaceMotion.split(" ")) expect(element.classList.contains(token)).toBe(true)
}

describe("shared interaction feedback", () => {
  it("keeps dialog Escape dismissal and trigger focus restoration", async () => {
    mount(<Dialog><DialogTrigger asChild><Button>Open</Button></DialogTrigger>
      <DialogContent><DialogTitle>Preferences</DialogTitle><DialogDescription>Adjust preferences</DialogDescription><Button>Save</Button></DialogContent>
    </Dialog>)
    const trigger = container.querySelector("button")!
    act(() => { trigger.focus(); trigger.click() })
    const content = document.querySelector('[data-slot="dialog-content"]')!
    expectSurfaceMotion(content)
    expectSurfaceMotion(document.querySelector('[data-slot="dialog-overlay"]')!)
    expect(content.contains(document.activeElement)).toBe(true)
    key(document.activeElement!, "Escape")
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it("keeps keyboard menu selection and disabled item semantics", async () => {
    const select = vi.fn()
    mount(<DropdownMenu><DropdownMenuTrigger asChild><Button>Actions</Button></DropdownMenuTrigger>
      <DropdownMenuContent><DropdownMenuItem onSelect={select}>Run</DropdownMenuItem><DropdownMenuItem disabled>Unavailable</DropdownMenuItem></DropdownMenuContent>
    </DropdownMenu>)
    const trigger = container.querySelector("button")!
    act(() => trigger.focus())
    key(trigger, "ArrowDown")
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    const content = document.querySelector('[data-slot="dropdown-menu-content"]')!
    expectSurfaceMotion(content)
    expect(document.activeElement?.textContent).toBe("Run")
    expect(document.querySelector('[data-disabled]')?.getAttribute("aria-disabled")).toBe("true")
    key(document.activeElement!, "Enter")
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(select).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(trigger)
  })

  it("keeps required responsive dialogs open on Escape with shared motion", () => {
    mount(<ResponsiveDialog defaultOpen><ResponsiveDialogContent dismissable={false}>
      <ResponsiveDialogTitle>Required choice</ResponsiveDialogTitle>
      <ResponsiveDialogDescription>Choose before continuing</ResponsiveDialogDescription>
      <Button>Continue</Button>
    </ResponsiveDialogContent></ResponsiveDialog>)
    const content = document.querySelector('[data-slot="responsive-dialog-content"]')!
    expectSurfaceMotion(content)
    expect(content.classList.contains("surface-responsive")).toBe(true)
    key(document.activeElement!, "Escape")
    expect(document.querySelector('[data-slot="responsive-dialog-content"]')).toBe(content)
    expect(content.querySelector('[data-slot="dialog-close"]')).toBeNull()
  })

  it("keeps switch state feedback while limiting transitions to paint and transform", () => {
    mount(<Switch aria-label="Enable sound" />)
    const control = container.querySelector("button")!
    const thumb = control.querySelector('[data-slot="switch-thumb"]')!
    expect(control.className).not.toContain("transition-all")
    expect(control.className).toContain("switch-feedback")
    for (const token of feedbackMotion.split(" ")) {
      expect(control.classList.contains(token)).toBe(true)
      expect(thumb.classList.contains(token)).toBe(true)
    }
    act(() => control.click())
    expect(control.getAttribute("aria-checked")).toBe("true")
    expect(thumb.getAttribute("data-state")).toBe("checked")
  })
})
