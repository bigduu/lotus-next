import { act, type ComponentProps } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { ModelEffortPicker } from "./ModelEffortPicker"

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

type PickerProps = ComponentProps<typeof ModelEffortPicker>

function renderPicker(overrides: Partial<PickerProps> = {}) {
  const container = document.body.appendChild(document.createElement("div"))
  const root = createRoot(container)
  roots.push(root)
  let props: PickerProps = {
    models: ["gpt-6-sol", "glm-5.3", "gpt-5.6-sol"],
    model: "gpt-6-sol",
    onModelChange: vi.fn(),
    value: "high",
    onChange: vi.fn(),
    ...overrides,
  }
  act(() => root.render(<ModelEffortPicker {...props} />))

  return {
    props,
    rerender(next: Partial<PickerProps>) {
      props = { ...props, ...next }
      act(() => root.render(<ModelEffortPicker {...props} />))
    },
    trigger: () => container.querySelector<HTMLButtonElement>('[data-testid="model-effort-picker"]')!,
  }
}

function range() {
  return document.querySelector<HTMLInputElement>('input[type="range"][aria-label="推理强度"]')!
}

function modelButton() {
  return document.querySelector<HTMLButtonElement>('[data-testid="model-picker-model"]')!
}

function search() {
  return document.querySelector<HTMLInputElement>('input[aria-label="搜索模型"]')!
}

function visibleModels() {
  return [...document.querySelectorAll<HTMLElement>("[data-model-option]")].map(
    (item) => item.textContent?.trim(),
  )
}

function modelOption(model: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("[data-model-option]")].find(
    (option) => option.textContent?.trim() === model,
  )!
}

function changeInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  act(() => {
    setter?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

function pointerEvent(input: HTMLInputElement, type: "pointerdown" | "pointerup") {
  act(() => input.dispatchEvent(new Event(type, { bubbles: true })))
}

function keyEvent(element: HTMLElement, type: "keydown" | "keyup", key: string) {
  act(() => element.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true })))
}

function open(trigger: HTMLButtonElement) {
  act(() => trigger.click())
  expect(range()).not.toBeNull()
}

async function openModels() {
  act(() => modelButton().click())
  await act(async () => { await Promise.resolve() })
  expect(search()).not.toBeNull()
}

describe("ModelEffortPicker effort", () => {
  it("describes the authoritative model and effort through existing readable spans", () => {
    const picker = renderPicker()
    const descriptionIds = picker.trigger().getAttribute("aria-describedby")?.split(/\s+/) ?? []
    expect(descriptionIds).toHaveLength(2)
    const descriptions = descriptionIds.map((id) => document.getElementById(id))
    expect(descriptions.every((element) => element?.tagName === "SPAN")).toBe(true)
    expect(descriptions.map((element) => element?.textContent)).toEqual(["gpt-6-sol", "高"])

    picker.rerender({ model: "gpt-5.6-sol", value: "max" })
    expect(descriptions.map((element) => element?.textContent)).toEqual(["gpt-5.6-sol", "最大"])
  })

  it("previews a drag and commits once on release while the trigger waits for authoritative props", () => {
    const picker = renderPicker()
    const trigger = picker.trigger()
    expect(trigger.getAttribute("aria-label")).toBe("模型与推理强度")
    expect(trigger.textContent).toContain("gpt-6-sol")
    expect(trigger.textContent).toContain("高")
    open(trigger)

    pointerEvent(range(), "pointerdown")
    changeInput(range(), "2")
    changeInput(range(), "6")
    changeInput(range(), "5")
    expect(picker.props.onChange).not.toHaveBeenCalled()
    expect(trigger.textContent).toContain("高")
    expect(trigger.textContent).not.toContain("极高")

    pointerEvent(range(), "pointerup")
    expect(picker.props.onChange).toHaveBeenCalledExactlyOnceWith("xhigh")
    expect(trigger.textContent).toContain("高")
    expect(trigger.textContent).not.toContain("极高")
    act(() => range().dispatchEvent(new FocusEvent("blur", { bubbles: true })))
    expect(picker.props.onChange).toHaveBeenCalledTimes(1)

    picker.rerender({ value: "xhigh" })
    expect(trigger.textContent).toContain("极高")
    expect(range().value).toBe("5")
  })

  it("commits a keyboard gesture only on the matching navigation key release", () => {
    const picker = renderPicker({ value: "medium" })
    open(picker.trigger())

    keyEvent(range(), "keydown", "ArrowRight")
    changeInput(range(), "4")
    changeInput(range(), "5")
    expect(picker.props.onChange).not.toHaveBeenCalled()
    keyEvent(range(), "keyup", "Tab")
    expect(picker.props.onChange).not.toHaveBeenCalled()
    keyEvent(range(), "keyup", "ArrowRight")
    expect(picker.props.onChange).toHaveBeenCalledExactlyOnceWith("xhigh")

    picker.rerender({ value: "xhigh" })
    keyEvent(range(), "keydown", "Home")
    changeInput(range(), "0")
    keyEvent(range(), "keyup", "Home")
    expect(picker.props.onChange).toHaveBeenLastCalledWith("auto")

    picker.rerender({ value: "auto" })
    keyEvent(range(), "keydown", "End")
    changeInput(range(), "6")
    keyEvent(range(), "keyup", "End")
    expect(picker.props.onChange).toHaveBeenLastCalledWith("max")
    expect(picker.props.onChange).toHaveBeenCalledTimes(3)
  })

  it("commits direct assistive-technology input without waiting for pointer or keyboard events", () => {
    const picker = renderPicker()
    open(picker.trigger())
    changeInput(range(), "3")
    expect(picker.props.onChange).toHaveBeenCalledExactlyOnceWith("medium")
    expect(picker.trigger().textContent).toContain("高")

    picker.rerender({ value: "medium" })
    expect(range().value).toBe("3")
    expect(picker.trigger().textContent).toContain("中")
    expect(picker.props.onChange).toHaveBeenCalledTimes(1)
  })

  it("keeps automatic and explicit off as separate values and restores automatic without optimistic display", () => {
    const picker = renderPicker({ value: "auto" })
    expect(picker.trigger().textContent).toContain("自动")
    open(picker.trigger())
    expect(range().value).toBe("0")

    pointerEvent(range(), "pointerdown")
    changeInput(range(), "1")
    pointerEvent(range(), "pointerup")
    expect(picker.props.onChange).toHaveBeenCalledExactlyOnceWith("none")
    expect(picker.trigger().textContent).toContain("自动")
    picker.rerender({ value: "none" })
    expect(picker.trigger().textContent).toContain("关闭")
    expect(range().value).toBe("1")

    const reset = document.querySelector<HTMLButtonElement>('button[aria-label="恢复自动推理"]')!
    act(() => reset.click())
    expect(picker.props.onChange).toHaveBeenLastCalledWith("auto")
    expect(picker.props.onChange).toHaveBeenCalledTimes(2)
    expect(picker.trigger().textContent).toContain("关闭")
    picker.rerender({ value: "auto" })
    expect(picker.trigger().textContent).toContain("自动")
    expect(range().value).toBe("0")
  })

  it("exposes product Ultra only to the root and preserves its separate ordinary effort", () => {
    const picker = renderPicker({ value: "max", allowUltra: true, thinkingMode: "standard" })
    open(picker.trigger())
    expect(range().max).toBe("7")
    expect(range().value).toBe("6")
    changeInput(range(), "7")
    pointerEvent(range(), "pointerup")
    expect(picker.props.onChange).toHaveBeenCalledExactlyOnceWith("ultra")
    expect(picker.trigger().textContent).toContain("最大")
    expect(picker.trigger().textContent).not.toContain("Ultra")

    picker.rerender({ thinkingMode: "ultra" })
    expect(picker.trigger().textContent).toContain("Ultra")
    expect(range().value).toBe("7")
    picker.rerender({ thinkingMode: "standard" })
    expect(picker.trigger().textContent).toContain("最大")
    expect(range().value).toBe("6")
    expect(picker.props.onChange).toHaveBeenCalledTimes(1)

    picker.rerender({ allowUltra: false, thinkingMode: "ultra" })
    expect(range().max).toBe("6")
    expect(range().value).toBe("6")
    expect(picker.trigger().textContent).toContain("最大")
    expect(picker.trigger().textContent).not.toContain("Ultra")
  })
})

describe("ModelEffortPicker models", () => {
  it("searches case-insensitively and waits for model props after selecting an option", async () => {
    const picker = renderPicker()
    open(picker.trigger())
    await openModels()
    expect(document.activeElement).toBe(search())
    expect(visibleModels()).toEqual(["gpt-6-sol", "glm-5.3", "gpt-5.6-sol"])
    expect(modelOption("gpt-6-sol").getAttribute("aria-pressed")).toBe("true")

    changeInput(search(), "GPT")
    expect(visibleModels()).toEqual(["gpt-6-sol", "gpt-5.6-sol"])
    changeInput(search(), "missing")
    expect(visibleModels()).toEqual([])
    expect(document.querySelector('[role="status"]')?.textContent).toContain("没有匹配的模型")
    changeInput(search(), "5.6")
    const option = document.querySelector<HTMLButtonElement>("[data-model-option]")!
    expect(option.getAttribute("aria-pressed")).toBe("false")
    act(() => option.click())
    expect(picker.props.onModelChange).toHaveBeenCalledExactlyOnceWith("gpt-5.6-sol")
    expect(search()).toBeNull()
    expect(range()).toBeNull()
    expect(picker.trigger().textContent).toContain("gpt-6-sol")
    expect(picker.trigger().textContent).not.toContain("gpt-5.6-sol")

    picker.rerender({ model: "gpt-5.6-sol" })
    expect(picker.trigger().textContent).toContain("gpt-5.6-sol")
    open(picker.trigger())
    await openModels()
    expect(search().value).toBe("")
    expect(visibleModels()).toEqual(["gpt-6-sol", "glm-5.3", "gpt-5.6-sol"])
    expect(modelOption("gpt-5.6-sol").getAttribute("aria-pressed")).toBe("true")
  })

  it("returns from models to effort and clears search after going back or closing the picker", async () => {
    const picker = renderPicker()
    open(picker.trigger())
    await openModels()
    changeInput(search(), "glm")
    const back = document.querySelector<HTMLButtonElement>('button[aria-label="后退"]')!
    act(() => back.click())
    expect(search()).toBeNull()
    expect(range()).not.toBeNull()
    await openModels()
    expect(search().value).toBe("")

    changeInput(search(), "5.6")
    act(() => picker.trigger().click())
    expect(search()).toBeNull()
    open(picker.trigger())
    await openModels()
    expect(search().value).toBe("")
    expect(picker.props.onModelChange).not.toHaveBeenCalled()
    expect(picker.props.onChange).not.toHaveBeenCalled()
  })

  it("keeps effort available without models and disables the model subpage", () => {
    const picker = renderPicker({ models: [], model: "" })
    expect(picker.trigger().disabled).toBe(false)
    open(picker.trigger())
    expect(modelButton().disabled).toBe(true)
    act(() => modelButton().click())
    expect(search()).toBeNull()
    changeInput(range(), "2")
    pointerEvent(range(), "pointerup")
    expect(picker.props.onChange).toHaveBeenCalledExactlyOnceWith("low")
    expect(picker.props.onModelChange).not.toHaveBeenCalled()
  })
})

describe("ModelEffortPicker availability", () => {
  it("allows effort while model switching is disabled", () => {
    const picker = renderPicker({ modelDisabled: true })
    expect(picker.trigger().disabled).toBe(false)
    open(picker.trigger())
    expect(modelButton().disabled).toBe(true)
    act(() => modelButton().click())
    expect(search()).toBeNull()
    expect(range().disabled).toBe(false)
    changeInput(range(), "6")
    pointerEvent(range(), "pointerup")
    expect(picker.props.onChange).toHaveBeenCalledExactlyOnceWith("max")
    expect(picker.props.onModelChange).not.toHaveBeenCalled()
  })

  it("allows model switching while effort and its reset action are disabled", async () => {
    const picker = renderPicker({ disabled: true })
    expect(picker.trigger().disabled).toBe(false)
    open(picker.trigger())
    expect(range().disabled).toBe(true)
    const reset = document.querySelector<HTMLButtonElement>('button[aria-label="恢复自动推理"]')!
    expect(reset.disabled).toBe(true)
    changeInput(range(), "6")
    pointerEvent(range(), "pointerup")
    keyEvent(range(), "keyup", "End")
    act(() => reset.click())
    expect(picker.props.onChange).not.toHaveBeenCalled()
    expect(modelButton().disabled).toBe(false)
    await openModels()
    const option = modelOption("glm-5.3")
    act(() => option.click())
    expect(picker.props.onModelChange).toHaveBeenCalledExactlyOnceWith("glm-5.3")
  })

  it("keeps root effort unconfirmed until thinking-mode authority arrives while models remain available", () => {
    const picker = renderPicker({ allowUltra: true, thinkingMode: null, value: "max" })
    expect(picker.trigger().textContent).toContain("未确认")
    expect(picker.trigger().disabled).toBe(false)
    open(picker.trigger())
    expect(range().disabled).toBe(true)
    changeInput(range(), "7")
    pointerEvent(range(), "pointerup")
    expect(picker.props.onChange).not.toHaveBeenCalled()
    expect(modelButton().disabled).toBe(false)

    picker.rerender({ thinkingMode: "standard" })
    expect(picker.trigger().textContent).toContain("最大")
    expect(range().disabled).toBe(false)
    expect(range().value).toBe("6")
  })

  it.each([
    { modelDisabled: true, models: ["gpt-6-sol"] },
    { modelDisabled: false, models: [] },
  ])("keeps the picker closed when both controls are unavailable: %o", (availability) => {
    const picker = renderPicker({ ...availability, disabled: true })
    expect(picker.trigger().disabled).toBe(true)
    act(() => picker.trigger().click())
    expect(range()).toBeNull()
    expect(search()).toBeNull()
    expect(picker.props.onChange).not.toHaveBeenCalled()
    expect(picker.props.onModelChange).not.toHaveBeenCalled()
  })
})
