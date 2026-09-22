import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest"

import { ReasoningPicker } from "./ReasoningPicker"

const roots: Root[] = []
const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

beforeAll(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => {
  Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT")
})

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.replaceChildren()
})

it("keeps Auto distinct from the explicit Off level", () => {
  const container = document.body.appendChild(document.createElement("div"))
  const root = createRoot(container)
  roots.push(root)
  const onChange = vi.fn()

  act(() => root.render(<ReasoningPicker value="auto" onChange={onChange} />))

  const trigger = container.querySelector<HTMLButtonElement>(
    'button[aria-label="推理强度"]',
  )
  expect(trigger?.textContent).toContain("自动")

  act(() => root.render(<ReasoningPicker value="none" onChange={onChange} />))
  expect(
    container.querySelector<HTMLButtonElement>('button[aria-label="推理强度"]')
      ?.textContent,
  ).toContain("关闭")
  expect(onChange).not.toHaveBeenCalled()
})
