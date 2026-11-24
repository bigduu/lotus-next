import { render, type ComponentProps, type JSX } from "@solidjs/web"
import { createSignal, flush } from "solid-js"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ModelEffortPicker } from "./ModelEffortPicker"

// The production build compiles Kobalte's Solid JSX export. Vitest's scoped
// JSX transforms cover our sources, so load the equivalent compiled entry.
vi.mock("@kobalte/core/popover", async () => {
  const { createRequire } = await vi.importActual<{
    createRequire: (url: string) => { resolve: (name: string) => string }
  }>("node:module")
  const entry = createRequire(import.meta.url).resolve("@kobalte/core/popover")
  return vi.importActual(entry.replace(/\.jsx$/, ".js"))
})

vi.mock("@lucide/solid", () => {
  const Icon = (props: Pick<JSX.IntrinsicElements["svg"], "class" | "aria-hidden">) =>
    <svg class={props.class} aria-hidden={props["aria-hidden"]} />
  return { Check: Icon, ChevronDown: Icon, ChevronLeft: Icon, ChevronRight: Icon, RotateCcw: Icon, Search: Icon, Sparkles: Icon, X: Icon }
})

let cleanup: (() => void) | undefined

afterEach(() => { cleanup?.() })

type PickerProps = ComponentProps<typeof ModelEffortPicker>

function renderPicker(overrides: Partial<PickerProps> = {}) {
  const container = document.body.appendChild(document.createElement("div"))
  const props: PickerProps = {
    modelGroups: [{ provider: "fixture", label: "Fixture", models: ["gpt-6-sol", "glm-5.3", "gpt-5.6-sol"] }],
    model: "gpt-6-sol",
    modelProvider: "fixture",
    onModelChange: vi.fn(),
    value: "high",
    onChange: vi.fn(),
    ...overrides,
  }
  const [current, setCurrent] = createSignal(props)
  const dispose = render(() => <ModelEffortPicker {...current()} />, container)
  cleanup = () => { dispose(); container.remove() }
  flush()

  return {
    props,
    rerender(next: Partial<PickerProps>) {
      setCurrent((previous) => ({ ...previous, ...next }))
      flush()
    },
    trigger: () => container.querySelector<HTMLButtonElement>('[data-testid="model-effort-picker"]')!,
  }
}

function interact(action: () => void) {
  action()
  flush()
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
  interact(() => {
    setter?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

function pointerEvent(input: HTMLInputElement, type: "pointerdown" | "pointerup") {
  interact(() => input.dispatchEvent(new Event(type, { bubbles: true })))
}

function keyEvent(element: HTMLElement, type: "keydown" | "keyup", key: string) {
  interact(() => element.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true })))
}

function open(trigger: HTMLButtonElement) {
  interact(() => trigger.click())
  expect(range()).not.toBeNull()
}

async function openModels() {
  interact(() => modelButton().click())
  await Promise.resolve()
  flush()
  expect(search()).not.toBeNull()
}

describe("ModelEffortPicker effort", () => {
  it("describes the authoritative model, provider, and effort", () => {
    const picker = renderPicker()
    const descriptionIds = picker.trigger().getAttribute("aria-describedby")?.split(/\s+/) ?? []
    expect(descriptionIds).toHaveLength(3)
    const descriptions = descriptionIds.map((id) => document.getElementById(id))
    expect(descriptions.every((element) => element?.tagName === "SPAN")).toBe(true)
    expect(descriptions.map((element) => element?.textContent)).toEqual(["gpt-6-sol", " · Fixture", "高"])

    picker.rerender({ model: "gpt-5.6-sol", value: "max" })
    expect(descriptions.map((element) => element?.textContent)).toEqual(["gpt-5.6-sol", " · Fixture", "最大"])
  })

  it("keeps complete long model and mode names in the trigger description and tooltip", () => {
    const model = "synthetic-provider.analysis-model-with-a-long-responsive-name"
    const picker = renderPicker({
      model, modelGroups: [{ provider: "fixture", label: "Fixture", models: [model] }],
      value: "max", allowUltra: true, thinkingMode: "standard",
    })
    const descriptions = () => picker.trigger().getAttribute("aria-describedby")!.split(/\s+/)
      .map((id) => document.getElementById(id)!.textContent)
    expect(descriptions()).toEqual([model, " · Fixture", "最大"])
    expect(picker.trigger().title).toBe(`${model} · 最大`)
    picker.rerender({ thinkingMode: "ultra" })
    expect(descriptions()).toEqual([model, " · Fixture", "Ultra"])
    expect(picker.trigger().title).toBe(`${model} · Ultra`)
    picker.rerender({ thinkingMode: null })
    expect(descriptions()).toEqual([model, " · Fixture", "未确认"])
    expect(picker.trigger().title).toBe(`${model} · 未确认`)
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
    interact(() => range().dispatchEvent(new FocusEvent("blur", { bubbles: true })))
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
    interact(() => reset.click())
    expect(picker.props.onChange).toHaveBeenLastCalledWith("auto")
    expect(picker.props.onChange).toHaveBeenCalledTimes(2)
    expect(picker.trigger().textContent).toContain("关闭")
    picker.rerender({ value: "auto" })
    expect(picker.trigger().textContent).toContain("自动")
    expect(range().value).toBe("0")
  })

  it("keeps Ultra preview and confirmation compact without an explanatory footer", () => {
    const picker = renderPicker({ value: "max", allowUltra: true, thinkingMode: "standard" })
    expect(picker.trigger().textContent).not.toContain("Ultra")
    open(picker.trigger())
    expect(document.querySelector('.model-effort-panel p[aria-hidden]')).toBeNull()
    pointerEvent(range(), "pointerdown")
    changeInput(range(), "7")
    expect(picker.props.onChange).not.toHaveBeenCalled()
    expect(document.querySelector('.model-effort-panel p[aria-hidden]')).toBeNull()
    const meteors = [...document.querySelectorAll<HTMLElement>(".effort-meteors i")]
    expect(meteors).toHaveLength(3)
    expect(new Set(meteors.map((item) => item.style.animationDuration)).size).toBe(3)
    expect(new Set(meteors.map((item) => item.style.animationDelay)).size).toBe(3)
    expect(meteors[0]!.closest('[aria-hidden="true"]')).not.toBeNull()
    pointerEvent(range(), "pointerup")
    expect(picker.props.onChange).toHaveBeenCalledExactlyOnceWith("ultra")
    picker.rerender({ thinkingMode: "ultra" })
    expect(picker.trigger().title).toContain("Ultra")
    expect(document.querySelector('.model-effort-panel p[aria-hidden]')).toBeNull()
    picker.rerender({ thinkingMode: "standard" })
    expect(document.querySelector('.model-effort-panel p[aria-hidden]')).toBeNull()
    expect(document.querySelector(".effort-meteors")).toBeNull()
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
  it("keeps composition Enter in model search without choosing a model or effort", async () => {
    const picker = renderPicker()
    open(picker.trigger())
    await openModels()
    interact(() => search().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })))
    changeInput(search(), "gpt")
    interact(() => search().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", isComposing: true, bubbles: true })))
    expect(picker.props.onModelChange).not.toHaveBeenCalled()
    expect(picker.props.onChange).not.toHaveBeenCalled()
    expect(search().value).toBe("gpt")
    expect(visibleModels()).toEqual(["gpt-6-sol", "gpt-5.6-sol"])
    interact(() => search().dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })))
    interact(() => modelOption("gpt-5.6-sol").click())
    expect(picker.props.onModelChange).toHaveBeenCalledExactlyOnceWith({ provider: "fixture", model: "gpt-5.6-sol" })
  })

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
    interact(() => option.click())
    expect(picker.props.onModelChange).toHaveBeenCalledExactlyOnceWith({ provider: "fixture", model: "gpt-5.6-sol" })
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
    interact(() => back.click())
    expect(search()).toBeNull()
    expect(range()).not.toBeNull()
    await openModels()
    expect(search().value).toBe("")

    changeInput(search(), "5.6")
    interact(() => picker.trigger().click())
    expect(search()).toBeNull()
    open(picker.trigger())
    await openModels()
    expect(search().value).toBe("")
    expect(picker.props.onModelChange).not.toHaveBeenCalled()
    expect(picker.props.onChange).not.toHaveBeenCalled()
  })

  it("keeps effort available without models and disables the model subpage", () => {
    const picker = renderPicker({ modelGroups: [], model: "" })
    expect(picker.trigger().getAttribute("aria-disabled")).toBeNull()
    open(picker.trigger())
    expect(modelButton().disabled).toBe(true)
    interact(() => modelButton().click())
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
    expect(picker.trigger().getAttribute("aria-disabled")).toBeNull()
    open(picker.trigger())
    expect(modelButton().disabled).toBe(true)
    interact(() => modelButton().click())
    expect(search()).toBeNull()
    expect(range().getAttribute("aria-disabled")).toBeNull()
    changeInput(range(), "6")
    pointerEvent(range(), "pointerup")
    expect(picker.props.onChange).toHaveBeenCalledExactlyOnceWith("max")
    expect(picker.props.onModelChange).not.toHaveBeenCalled()
  })

  it("allows model switching while effort and its reset action are disabled", async () => {
    const picker = renderPicker({ disabled: true })
    expect(picker.trigger().getAttribute("aria-disabled")).toBeNull()
    open(picker.trigger())
    expect(range().getAttribute("aria-disabled")).toBe("true")
    const reset = document.querySelector<HTMLButtonElement>('button[aria-label="恢复自动推理"]')!
    expect(reset.disabled).toBe(true)
    changeInput(range(), "6")
    pointerEvent(range(), "pointerup")
    keyEvent(range(), "keyup", "End")
    interact(() => reset.click())
    expect(picker.props.onChange).not.toHaveBeenCalled()
    expect(modelButton().disabled).toBe(false)
    await openModels()
    const option = modelOption("glm-5.3")
    interact(() => option.click())
    expect(picker.props.onModelChange).toHaveBeenCalledExactlyOnceWith({ provider: "fixture", model: "glm-5.3" })
  })

  it("keeps root effort unconfirmed until thinking-mode authority arrives while models remain available", () => {
    const picker = renderPicker({ allowUltra: true, thinkingMode: null, value: "max" })
    expect(picker.trigger().textContent).toContain("未确认")
    expect(picker.trigger().getAttribute("aria-disabled")).toBeNull()
    open(picker.trigger())
    expect(range().getAttribute("aria-disabled")).toBe("true")
    changeInput(range(), "7")
    pointerEvent(range(), "pointerup")
    expect(picker.props.onChange).not.toHaveBeenCalled()
    expect(modelButton().disabled).toBe(false)

    picker.rerender({ thinkingMode: "standard" })
    expect(picker.trigger().textContent).toContain("最大")
    expect(range().getAttribute("aria-disabled")).toBeNull()
    expect(range().value).toBe("6")
  })

  it.each([
    { modelDisabled: true, modelGroups: [{ provider: "fixture", label: "Fixture", models: ["gpt-6-sol"] }] },
    { modelDisabled: false, modelGroups: [] },
  ])("keeps the picker closed when both controls are unavailable: %o", (availability) => {
    const picker = renderPicker({ ...availability, disabled: true })
    expect(picker.trigger().getAttribute("aria-disabled")).toBe("true")
    interact(() => picker.trigger().click())
    expect(range()).toBeNull()
    expect(search()).toBeNull()
    expect(picker.props.onChange).not.toHaveBeenCalled()
    expect(picker.props.onModelChange).not.toHaveBeenCalled()
  })
})
