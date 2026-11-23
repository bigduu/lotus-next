import { Portal, render } from "@solidjs/web"
import { flush } from "solid-js"
import { expect, it, vi } from "vitest"
import { SettingsFrame } from "./SettingsFrame"

vi.mock("@lucide/solid", () => ({ ArrowLeft: () => null }))

it("focuses the page title and leaves Escape to nested controls and composition", async () => {
  const host = document.body.appendChild(document.createElement("div"))
  const onClose = vi.fn()
  const dispose = render(() => (
    <SettingsFrame onClose={onClose}>
      <input role="combobox" data-fixture="combobox" />
      <div data-slot="popover-content"><button data-fixture="popover">Popover</button></div>
      <select data-fixture="select"><option>Selection</option></select>
      <button data-fixture="prevented" onKeyDown={(event) => event.preventDefault()}>Nested handler</button>
      <Portal><div role="dialog"><button data-fixture="dialog">Nested dialog</button></div></Portal>
    </SettingsFrame>
  ), host)
  const escape = (target: Element, options: KeyboardEventInit = {}) =>
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, ...options }))
  try {
    await Promise.resolve()
    flush()
    const title = host.querySelector("h1")!
    expect(host.querySelector("main")?.getAttribute("aria-labelledby")).toBe(title.id)
    expect(document.activeElement).toBe(title)
    for (const control of document.querySelectorAll("[data-fixture]")) {
      escape(control)
      expect(onClose).not.toHaveBeenCalled()
    }
    escape(title, { isComposing: true })
    expect(onClose).not.toHaveBeenCalled()
    escape(title)
    host.querySelector<HTMLButtonElement>("header button")!.click()
    expect(onClose).toHaveBeenCalledTimes(2)
  } finally {
    dispose()
    host.remove()
  }
})
