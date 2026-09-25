import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { ModelPicker } from "./ModelPicker"

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

function changeInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  act(() => {
    setter?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

function visibleModels() {
  return [...document.querySelectorAll<HTMLElement>("[data-model-option]")].map(
    (item) => item.textContent?.trim(),
  )
}

describe("ModelPicker search", () => {
  it("keeps the model menu closed while switching is disabled", () => {
    const container = document.body.appendChild(document.createElement("div"))
    const root = createRoot(container)
    roots.push(root)
    act(() => root.render(
      <ModelPicker models={["gpt-6-sol", "grok-4.7"]} value="gpt-6-sol" onChange={vi.fn()} disabled />,
    ))

    const trigger = container.querySelector<HTMLButtonElement>("button")
    expect(trigger?.disabled).toBe(true)
    act(() => trigger?.click())
    expect(document.querySelector('input[aria-label="搜索模型"]')).toBeNull()
  })

  it("focuses search, filters case-insensitively, selects, and resets on reopen", async () => {
    const container = document.body.appendChild(document.createElement("div"))
    const root = createRoot(container)
    roots.push(root)
    const onChange = vi.fn()

    act(() => root.render(
      <ModelPicker
        models={["codex-auto-review", "glm-5.3", "glm-5.3-dashscope", "gpt-5.6-sol"]}
        value="glm-5.3-dashscope"
        onChange={onChange}
      />,
    ))

    const trigger = container.querySelector<HTMLButtonElement>("button")
    expect(trigger).not.toBeNull()
    act(() => trigger?.click())
    await act(async () => { await Promise.resolve() })

    const search = document.querySelector<HTMLInputElement>('input[aria-label="搜索模型"]')
    expect(search).not.toBeNull()
    expect(document.activeElement).toBe(search)
    expect(visibleModels()).toEqual([
      "codex-auto-review",
      "glm-5.3",
      "glm-5.3-dashscope",
      "gpt-5.6-sol",
    ])

    changeInput(search!, "GPT")
    expect(visibleModels()).toEqual(["gpt-5.6-sol"])

    changeInput(search!, "missing")
    expect(visibleModels()).toEqual([])
    expect(document.querySelector('[role="status"]')?.textContent).toContain("没有匹配的模型")

    changeInput(search!, "auto")
    const option = document.querySelector<HTMLButtonElement>("[data-model-option]")
    act(() => option?.click())
    expect(onChange).toHaveBeenCalledExactlyOnceWith("codex-auto-review")
    expect(document.querySelector('input[aria-label="搜索模型"]')).toBeNull()

    act(() => trigger?.click())
    await act(async () => { await Promise.resolve() })
    expect(document.querySelector<HTMLInputElement>('input[aria-label="搜索模型"]')?.value).toBe("")
  })
})
