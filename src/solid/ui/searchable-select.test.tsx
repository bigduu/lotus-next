import { createSignal, flush } from "solid-js"
import { render, type JSX } from "@solidjs/web"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SearchableSelect } from "./searchable-select"

vi.mock("@kobalte/core/popover", async () => (await import("../test/compiledKobalte")).compiledKobalte("popover"))
vi.mock("@lucide/solid", () => {
  const Icon = () => <svg aria-hidden="true" />
  return { Check: Icon, ChevronDown: Icon, Search: Icon, X: Icon }
})

const identity = (item: string) => item
const strings = { getKey: identity, getValue: identity, getLabel: identity }
const schedule = setTimeout
async function settle(action: () => unknown = () => undefined) {
  await action()
  flush()
  await new Promise<void>((resolve) => schedule(resolve, 0))
  flush()
}

let container: HTMLDivElement
let dispose: (() => void) | undefined
const scroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView")
beforeEach(() => {
  container = document.body.appendChild(document.createElement("div"))
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() })
})
afterEach(() => {
  dispose?.()
  dispose = undefined
  container.remove()
  if (scroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scroll)
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView")
})

function mount(component: () => JSX.Element) {
  dispose = render(component, container)
  flush()
}

const trigger = () => container.querySelector<HTMLButtonElement>("button")!
const input = () => document.querySelector<HTMLInputElement>('input[role="combobox"]')!
const active = () => document.querySelector('[role="option"][aria-selected="true"]')
const name = (field: HTMLInputElement) => document.getElementById(field.getAttribute("aria-labelledby") ?? "")?.textContent

function press(field: HTMLElement, key: string, keyCode?: number) {
  const event = new KeyboardEvent("keydown", { key, keyCode, code: key === " " ? "Space" : key, bubbles: true, cancelable: true })
  field.dispatchEvent(event)
  flush()
  return event
}

function search(value: string) {
  const field = input()
  field.value = value
  field.dispatchEvent(new Event("input", { bubbles: true }))
  flush()
}

function visibleOptions(attribute = "data-searchable-option") {
  return [...document.querySelectorAll<HTMLElement>(`[${attribute}]:not([hidden])`)].map((item) => item.textContent?.trim())
}

describe("SearchableSelect generic behavior", () => {
  it.each(["Enter", " "])("clears a query from the focused clear button's %s without choosing an option", async (key) => {
    const onChange = vi.fn()
    mount(() => <SearchableSelect items={["Alpha", "Beta"]} value="Alpha" onChange={onChange} {...strings} />)
    await settle(() => trigger().click())
    const field = input()
    search("beta")
    expect(visibleOptions()).toEqual(["Beta"])
    const clear = document.querySelector<HTMLButtonElement>('[aria-label="清空搜索"]')!
    clear.focus()
    const event = press(clear, key)
    expect(event.defaultPrevented).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
    // JSDOM does not synthesize the button's native keyboard click.
    await settle(() => clear.click())
    expect(field.isConnected).toBe(true)
    expect(trigger().getAttribute("aria-expanded")).toBe("true")
    expect(field.value).toBe("")
    expect(document.activeElement).toBe(field)
    expect(visibleOptions()).toEqual(["Alpha", "Beta"])
    expect(onChange).not.toHaveBeenCalled()
    search("beta")
    press(field, "Enter")
    expect(onChange).toHaveBeenCalledExactlyOnceWith("Beta")
  })

  it("replaces the active descendant when a live list changes without changing count", async () => {
    const [items, setItems] = createSignal(["Alpha", "Beta"])
    const onChange = vi.fn()
    mount(() => <SearchableSelect items={items()} value="Alpha" onChange={onChange} {...strings} />)
    await settle(() => trigger().click())
    const field = input()
    const previousId = field.getAttribute("aria-activedescendant")!
    expect(document.getElementById(previousId)?.textContent).toBe("Alpha")
    await settle(() => setItems(["Gamma", "Delta"]))
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(2)
    expect(field.hasAttribute("aria-activedescendant")).toBe(false)
    press(field, "Enter")
    expect(onChange).not.toHaveBeenCalled()
    press(field, "ArrowDown")
    expect(active()?.textContent).toBe("Gamma")
    expect(field.getAttribute("aria-activedescendant")).toBe(active()?.id)
    expect(document.getElementById(previousId)).toBeNull()
  })

  it("closes and discards its query when disabled without reopening on enable", async () => {
    const [disabled, setDisabled] = createSignal(false)
    mount(() => <SearchableSelect items={["Alpha", "Beta"]} value="Alpha" disabled={disabled()} onChange={vi.fn()} {...strings} />)
    await settle(() => trigger().click())
    search("beta")
    expect(visibleOptions()).toEqual(["Beta"])
    await settle(() => setDisabled(true))
    expect(input()).toBeNull()
    await settle(() => setDisabled(false))
    expect(input()).toBeNull()
    await settle(() => trigger().click())
    expect(input().value).toBe("")
    expect(visibleOptions()).toEqual(["Alpha", "Beta"])
  })

  it("starts from the selected value, cancels without changing it and returns focus to its trigger", async () => {
    const items = [{ id: 1, name: "Alpha" }, { id: 2, name: "Beta" }, { id: 3, name: "Gamma" }]
    const onChange = vi.fn()
    mount(() => <SearchableSelect items={items} value={2} onChange={onChange}
      getKey={(item) => String(item.id)} getValue={(item) => item.id} getLabel={(item) => item.name} />)
    await settle(() => { trigger().focus(); trigger().click() })
    expect(active()?.textContent).toBe("Beta")
    expect(input().getAttribute("aria-activedescendant")).toBe(active()?.id)
    expect(name(input())).toBe("搜索")
    press(input(), "ArrowDown")
    expect(active()?.textContent).toBe("Gamma")
    expect(onChange).not.toHaveBeenCalled()
    await settle(() => press(input(), "Escape"))
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger()))
    expect(onChange).not.toHaveBeenCalled()
    await settle(() => trigger().click())
    expect(active()?.textContent).toBe("Beta")
    expect(input().getAttribute("aria-activedescendant")).toBe(active()?.id)
    press(input(), "Enter")
    expect(onChange).toHaveBeenCalledExactlyOnceWith(2)
  })

  it("keeps IME confirmation and candidate Escape at the search field", async () => {
    const onChange = vi.fn()
    mount(() => <SearchableSelect items={["中文一", "中文二"]} value="中文一" onChange={onChange} {...strings} />)
    await settle(() => trigger().click())
    const field = input()
    field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }))
    search("中文")
    const selected = field.getAttribute("aria-activedescendant")
    for (const key of ["ArrowDown", "Enter", "Escape"]) press(field, key)
    expect(document.activeElement).toBe(field)
    expect(field.getAttribute("aria-activedescendant")).toBe(selected)
    expect(onChange).not.toHaveBeenCalled()
    field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "中文" }))
    press(field, "Enter", 229)
    expect(onChange).not.toHaveBeenCalled()
    press(field, "ArrowDown")
    press(field, "Enter")
    expect(onChange).toHaveBeenCalledExactlyOnceWith("中文二")
  })

  it("scopes search and highlighted value to each selector", async () => {
    const [first, setFirst] = createSignal("Alpha")
    const [second, setSecond] = createSignal("Gamma")
    const items = ["Alpha", "Beta", "Gamma"]
    mount(() => <>
      <SearchableSelect items={items} value={first()} onChange={setFirst} searchAriaLabel="First search" {...strings} />
      <SearchableSelect items={items} value={second()} onChange={setSecond} searchAriaLabel="Second search" {...strings} />
    </>)
    const [firstTrigger, secondTrigger] = container.querySelectorAll<HTMLButtonElement>('[data-slot="popover-trigger"]')
    await settle(() => firstTrigger.click())
    expect(name(input())).toBe("First search")
    search("beta")
    await settle(() => press(input(), "Enter"))
    expect(firstTrigger.textContent).toBe("Beta")
    await settle(() => secondTrigger.click())
    expect(name(input())).toBe("Second search")
    expect(input().value).toBe("")
    expect(active()?.textContent).toBe("Gamma")
    expect(firstTrigger.textContent).toBe("Beta")
    await settle(() => press(input(), "Escape"))
    await settle(() => firstTrigger.click())
    expect(name(input())).toBe("First search")
    expect(input().value).toBe("")
    expect(active()?.textContent).toBe("Beta")
  })

  it("focuses search, filters labels and extra terms case-insensitively, selects a numeric value and clears on reopen", async () => {
    const items = [
      { id: 1, name: "codex-auto-review", aliases: ["self-review", "auto"] },
      { id: 2, name: "glm-5.3", aliases: ["chat"] },
      { id: 3, name: "glm-5.3-dashscope", aliases: ["dashscope"] },
      { id: 4, name: "gpt-5.6-sol", aliases: ["openai", "sol"] },
    ]
    const onChange = vi.fn()
    mount(() => <SearchableSelect items={items} value={3} onChange={onChange}
      getKey={(item) => String(item.id)} getValue={(item) => item.id} getLabel={(item) => item.name}
      getSearchTerms={(item) => item.aliases} placeholder="选择模型" searchPlaceholder="搜索模型…" clearLabel="清空模型搜索"
      emptyText="没有匹配的模型" menuPlacement="up" menuAlign="left" searchAriaLabel="搜索模型"
      optionListAriaLabel="模型列表" optionDataAttr="data-model-option" />)
    expect(trigger().textContent).toContain("glm-5.3-dashscope")
    await settle(() => trigger().click())
    expect(document.activeElement).toBe(input())
    expect(name(input())).toBe("搜索模型")
    expect(document.querySelector('[role="listbox"]')?.getAttribute("aria-label")).toBe("模型列表")
    expect(visibleOptions("data-model-option")).toEqual(items.map((item) => item.name))
    search("GPT")
    expect(visibleOptions("data-model-option")).toEqual(["gpt-5.6-sol"])
    search("alias:self-review")
    expect(visibleOptions("data-model-option")).toEqual([])
    expect(document.querySelector('[role="status"]')?.textContent).toContain("没有匹配的模型")
    search("self-review")
    expect(visibleOptions("data-model-option")).toEqual(["codex-auto-review"])
    await settle(() => document.querySelector<HTMLElement>("[data-model-option]")!.click())
    expect(onChange).toHaveBeenCalledExactlyOnceWith(1)
    expect(input()).toBeNull()
    await settle(() => trigger().click())
    expect(input().value).toBe("")
  })

  it("renders the placeholder when the value matches no item", () => {
    mount(() => <SearchableSelect items={["Alpha"]} value="missing" onChange={() => {}} placeholder="未选择" {...strings} />)
    expect(trigger().textContent).toContain("未选择")
  })

  it("clears the search query when clicking the clear button", async () => {
    mount(() => <SearchableSelect items={["Alpha", "Beta"]} value="Alpha" onChange={() => {}} {...strings} />)
    await settle(() => trigger().click())
    search("beta")
    expect(visibleOptions()).toEqual(["Beta"])
    await settle(() => document.querySelector<HTMLButtonElement>('[aria-label="清空搜索"]')!.click())
    expect(input().value).toBe("")
    expect(visibleOptions()).toEqual(["Alpha", "Beta"])
    expect(document.activeElement).toBe(input())
  })
})
