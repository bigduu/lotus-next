import { flush } from "solid-js"
import { render, type JSX } from "@solidjs/web"
import { afterEach, describe, expect, it, vi } from "vitest"
import { feedbackMotion, surfaceMotion } from "@shared/theme/motion"
import { Button } from "./button"
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./dialog"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSub,
  DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "./dropdown-menu"
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogTitle } from "./responsive-dialog"
import { Switch } from "./switch"

vi.mock("@kobalte/core/dialog", async () => (await import("../test/compiledKobalte")).compiledKobalte("dialog"))
vi.mock("@kobalte/core/dropdown-menu", async () => (await import("../test/compiledKobalte")).compiledKobalte("dropdown-menu"))
vi.mock("@kobalte/core/switch", async () => (await import("../test/compiledKobalte")).compiledKobalte("switch"))
vi.mock("@lucide/solid", () => {
  const Icon = () => <svg aria-hidden="true" />
  return { Check: Icon, ChevronRight: Icon, Circle: Icon, X: Icon }
})

let cleanup: (() => void) | undefined
afterEach(() => { cleanup?.(); cleanup = undefined })

function mount(view: () => JSX.Element) {
  const container = document.body.appendChild(document.createElement("div"))
  const dispose = render(view, container)
  flush()
  cleanup = () => { dispose(); container.remove() }
  return container
}

function key(element: Element, value: string) {
  element.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }))
  flush()
}

function expectSurfaceMotion(element: Element) {
  for (const token of surfaceMotion.split(" ")) expect(element.classList.contains(token)).toBe(true)
}

describe("shared interaction feedback", () => {
  it("keeps dialog Escape dismissal and trigger focus restoration", async () => {
    const container = mount(() => <Dialog><DialogTrigger>Open</DialogTrigger>
      <DialogContent><DialogTitle>Preferences</DialogTitle><DialogDescription>Adjust preferences</DialogDescription><Button>Save</Button></DialogContent>
    </Dialog>)
    const trigger = container.querySelector("button")!
    trigger.focus()
    trigger.click()
    flush()
    const content = document.querySelector('[data-slot="dialog-content"]')!
    expectSurfaceMotion(content)
    expectSurfaceMotion(document.querySelector('[data-slot="dialog-overlay"]')!)
    await vi.waitFor(() => expect(content.contains(document.activeElement)).toBe(true))
    key(document.activeElement!, "Escape")
    await vi.waitFor(() => {
      expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull()
      expect(document.activeElement).toBe(trigger)
    })
  })

  it("keeps keyboard menu selection and disabled item semantics", async () => {
    const select = vi.fn(), disabled = vi.fn()
    const container = mount(() => <DropdownMenu><DropdownMenuTrigger>Actions</DropdownMenuTrigger>
      <DropdownMenuContent><DropdownMenuItem disabled onSelect={disabled}>Unavailable</DropdownMenuItem>
        <DropdownMenuItem onSelect={select}>Run</DropdownMenuItem></DropdownMenuContent>
    </DropdownMenu>)
    const trigger = container.querySelector("button")!
    trigger.focus()
    key(trigger, "ArrowDown")
    const content = document.querySelector('[data-slot="dropdown-menu-content"]')!
    expectSurfaceMotion(content)
    await vi.waitFor(() => expect(document.activeElement?.textContent).toBe("Run"))
    expect(content.querySelector('[data-disabled]')?.getAttribute("aria-disabled")).toBe("true")
    key(document.activeElement!, "Enter")
    await vi.waitFor(() => {
      expect(select).toHaveBeenCalledOnce()
      expect(disabled).not.toHaveBeenCalled()
      expect(document.activeElement).toBe(trigger)
    })
  })

  it("leaves focus in a submenu when the pointer enters its own destination directly", async () => {
    const leave = vi.fn()
    const rootAutoFocus = vi.fn()
    const host = mount(() => <DropdownMenu><DropdownMenuTrigger>Actions</DropdownMenuTrigger>
      <DropdownMenuContent onOpenAutoFocus={rootAutoFocus}>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger onPointerLeave={leave}>Move</DropdownMenuSubTrigger>
          <DropdownMenuSubContent><DropdownMenuItem>Unsectioned</DropdownMenuItem></DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>)
    key(host.querySelector("button")!, "ArrowDown")
    const trigger = document.querySelector<HTMLElement>('[data-slot="dropdown-menu-sub-trigger"]')!
    // The modal focus trap opens independently of the list's roving focus.
    await vi.waitFor(() => {
      expect(rootAutoFocus).toHaveBeenCalled()
      expect(document.activeElement).toBe(trigger)
    })
    trigger.click()
    flush()
    const submenu = document.querySelector('[data-slot="dropdown-menu-sub-content"]')!
    const destination = submenu.querySelector<HTMLElement>('[role="menuitem"]')!
    await vi.waitFor(() => expect(submenu.contains(document.activeElement)).toBe(true))
    const focused = document.activeElement

    trigger.dispatchEvent(new PointerEvent("pointerleave", {
      pointerType: "mouse", relatedTarget: destination, clientX: -1, clientY: -1,
    }))
    flush()
    expect(leave).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(focused)
    expect(submenu.isConnected).toBe(true)

    key(document.activeElement!, "Escape")
    await vi.waitFor(() => {
      expect(submenu.isConnected).toBe(false)
      expect(document.activeElement).toBe(trigger)
    })
  })

  it("keeps required responsive dialogs open on Escape with shared motion", async () => {
    mount(() => <ResponsiveDialog defaultOpen><ResponsiveDialogContent dismissable={false}>
      <ResponsiveDialogTitle>Required choice</ResponsiveDialogTitle>
      <ResponsiveDialogDescription>Choose before continuing</ResponsiveDialogDescription>
      <Button>Continue</Button>
    </ResponsiveDialogContent></ResponsiveDialog>)
    const content = document.querySelector('[data-slot="responsive-dialog-content"]')!
    expectSurfaceMotion(content)
    expect(content.classList.contains("surface-responsive")).toBe(true)
    await vi.waitFor(() => expect(content.contains(document.activeElement)).toBe(true))
    key(document.activeElement!, "Escape")
    expect(document.querySelector('[data-slot="responsive-dialog-content"]')).toBe(content)
    expect(content.querySelector('[data-slot="responsive-dialog-close"]')).toBeNull()
  })

  it("keeps switch feedback on paint and transform while its accessible control changes state", () => {
    const container = mount(() => <Switch aria-label="Enable sound" />)
    const input = container.querySelector<HTMLInputElement>('[role="switch"]')!
    const control = container.querySelector('[data-slot="switch"]')!
    const thumb = control.querySelector('[data-slot="switch-thumb"]')!
    expect(control.className).not.toContain("transition-all")
    expect(control.className).toContain("switch-feedback")
    for (const token of feedbackMotion.split(" ")) {
      expect(control.classList.contains(token)).toBe(true)
      expect(thumb.classList.contains(token)).toBe(true)
    }
    expect(input.getAttribute("aria-label")).toBe("Enable sound")
    input.click()
    flush()
    expect(input.getAttribute("aria-checked")).toBe("true")
    expect(control.getAttribute("data-state")).toBe("checked")
    expect(thumb.getAttribute("data-state")).toBe("checked")
  })
})
