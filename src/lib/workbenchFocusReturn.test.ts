import { afterEach, expect, it } from "vitest"
import { captureWorkbenchFocusReturn } from "./workbenchFocusReturn"

afterEach(() => document.body.replaceChildren())

it("resolves the stable tab identity rather than a clone, title, or another session", () => {
  document.body.innerHTML = '<aside id="right-workbench"><div inert><button data-workbench-tab-handle="browser:a">Same title</button></div><button data-workbench-tab-handle="browser:b">Same title</button><button data-workbench-tab-handle="browser:a">Renamed title</button></aside>'
  const original = document.querySelectorAll<HTMLButtonElement>("button")[2]!
  const preview = original.cloneNode(true) as HTMLButtonElement
  let scope = "a"
  const resolve = captureWorkbenchFocusReturn(preview, scope, () => scope)
  expect(resolve()).toBe(original)
  scope = "b"
  expect(resolve()).toBeNull()
  scope = "a"
  original.remove()
  expect(resolve()).toBeNull()
})

it("also invalidates a regular editor opener when its session changes", () => {
  const editor = document.body.appendChild(document.createElement("input"))
  let scope = "a"
  const resolve = captureWorkbenchFocusReturn(editor, scope, () => scope)
  expect(resolve()).toBe(editor)
  scope = "b"
  expect(resolve()).toBeNull()
})
