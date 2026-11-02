import { afterEach, expect, it } from "vitest"
import { renderProbe } from "./renderProbe"

afterEach(() => { renderProbe.disable(); renderProbe.reset() })

it("counts nothing until it is enabled", () => {
  renderProbe.reset()
  renderProbe.count("example")
  expect(renderProbe.read()).toEqual({})
})

it("accumulates and ranks named counters while enabled", () => {
  renderProbe.enable()
  renderProbe.reset()
  renderProbe.count("a")
  renderProbe.count("a")
  renderProbe.count("b")
  expect(renderProbe.read()).toEqual({ a: 2, b: 1 })
})

it("resets counters without toggling the probe", () => {
  renderProbe.enable()
  renderProbe.count("a")
  renderProbe.reset()
  expect(renderProbe.read()).toEqual({})
  expect(renderProbe.isEnabled()).toBe(true)
})

it("stops counting once disabled", () => {
  renderProbe.enable()
  renderProbe.count("a")
  renderProbe.disable()
  renderProbe.count("a")
  expect(renderProbe.read()).toEqual({ a: 1 })
})
