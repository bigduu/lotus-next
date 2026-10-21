import { act, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { SearchableSelect } from "./searchable-select"

interface Model {
  id: number
  name: string
  aliases: string[]
}

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
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set
  act(() => {
    setter?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

function visibleOptions(dataAttr = "data-searchable-option") {
  return [...document.querySelectorAll<HTMLElement>(`[${dataAttr}]`)]
    .map((item) => item.textContent?.trim())
    .filter((text): text is string => text !== undefined)
}

describe("SearchableSelect generic behavior", () => {
  it.each(["Enter", " "])("clears a matching query with the focused clear button's %s without selecting an option", async (key) => {
    const container = document.body.appendChild(document.createElement("div"))
    const root = createRoot(container)
    roots.push(root)
    const onChange = vi.fn()
    act(() => root.render(<SearchableSelect items={["Alpha", "Beta"]} value="Alpha" onChange={onChange}
      getKey={(item) => item} getValue={(item) => item} getLabel={(item) => item} />))
    await act(async () => container.querySelector("button")!.click())
    const search = document.querySelector("input")!
    changeInput(search, "beta")
    expect(visibleOptions()).toEqual(["Beta"])
    const clear = document.querySelector<HTMLButtonElement>('[aria-label="清空搜索"]')!
    act(() => clear.focus())
    const event = new KeyboardEvent("keydown", { key, code: key === "Enter" ? "Enter" : "Space", bubbles: true, cancelable: true })
    act(() => clear.dispatchEvent(event))
    expect(onChange).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
    // jsdom does not synthesize a button's native keyboard click. Dispatch it
    // only after checking that the real Command root left that default intact.
    act(() => clear.click())
    expect(search.isConnected).toBe(true)
    expect(container.querySelector("button")?.getAttribute("aria-expanded")).toBe("true")
    expect(search.value).toBe("")
    expect(document.activeElement).toBe(search)
    expect(visibleOptions()).toEqual(["Alpha", "Beta"])
    expect(onChange).not.toHaveBeenCalled()
    changeInput(search, "beta")
    act(() => search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })))
    expect(onChange).toHaveBeenCalledExactlyOnceWith("Beta")
  })

  it("updates the active descendant when an open list replaces its items without changing the count", async () => {
    const container = document.body.appendChild(document.createElement("div"))
    const root = createRoot(container)
    roots.push(root)
    const render = (items: string[]) => act(() => root.render(<SearchableSelect items={items} value="Alpha"
      onChange={vi.fn()} getKey={(item) => item} getValue={(item) => item} getLabel={(item) => item} />))
    render(["Alpha", "Beta"])
    await act(async () => container.querySelector("button")!.click())
    const input = document.querySelector("input")!
    const previousId = input.getAttribute("aria-activedescendant")
    expect(document.getElementById(previousId ?? "")?.textContent).toBe("Alpha")
    render(["Gamma", "Delta"])
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(2)
    expect(input.hasAttribute("aria-activedescendant")).toBe(false)
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })))
    const selected = document.querySelector('[role="option"][aria-selected="true"]')!
    expect(selected.textContent).toBe("Gamma")
    expect(input.getAttribute("aria-activedescendant")).toBe(selected.id)
    expect(document.getElementById(previousId ?? "")).toBeNull()
  })

  it("closes and discards its query when disabled mid-search without reopening when enabled", async () => {
    const container = document.body.appendChild(document.createElement("div"))
    const root = createRoot(container)
    roots.push(root)
    const render = (disabled: boolean) => act(() => root.render(<SearchableSelect items={["Alpha", "Beta"]} value="Alpha" disabled={disabled}
      onChange={vi.fn()} getKey={(item) => item} getValue={(item) => item} getLabel={(item) => item} />))
    render(false)
    const trigger = container.querySelector("button")!
    await act(async () => trigger.click())
    changeInput(document.querySelector("input")!, "beta")
    expect(visibleOptions()).toEqual(["Beta"])
    render(true)
    expect(document.querySelector("input")).toBeNull()
    render(false)
    expect(document.querySelector("input")).toBeNull()
    await act(async () => trigger.click())
    expect(document.querySelector("input")?.value).toBe("")
    expect(visibleOptions()).toEqual(["Alpha", "Beta"])
  })

  it("navigates from the selected value, cancels without a change and returns focus to its trigger", async () => {
    const container = document.body.appendChild(document.createElement("div"))
    const root = createRoot(container)
    roots.push(root)
    const onChange = vi.fn()
    const items = [{ id: 1, name: "Alpha" }, { id: 2, name: "Beta" }, { id: 3, name: "Gamma" }]
    act(() => root.render(<SearchableSelect items={items} value={2} onChange={onChange}
      getKey={(item) => String(item.id)} getValue={(item) => item.id} getLabel={(item) => item.name} />))
    const trigger = container.querySelector("button")!
    await act(async () => { trigger.focus(); trigger.click() })
    const input = document.querySelector("input")!
    const active = () => document.querySelector('[role="option"][aria-selected="true"]')?.textContent
    expect(active()).toBe("Beta")
    expect(input.getAttribute("aria-activedescendant")).toBe(document.querySelector('[role="option"][aria-selected="true"]')?.id)
    expect(document.getElementById(input.getAttribute("aria-labelledby") ?? "")?.textContent).toBe("搜索")
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })))
    expect(active()).toBe("Gamma")
    expect(onChange).not.toHaveBeenCalled()
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })))
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger))
    expect(onChange).not.toHaveBeenCalled()
    await act(async () => trigger.click())
    const reopenedInput = document.querySelector("input")!
    expect(document.querySelector('[role="option"][aria-selected="true"]')?.textContent).toBe("Beta")
    expect(reopenedInput.getAttribute("aria-activedescendant")).toBe(document.querySelector('[role="option"][aria-selected="true"]')?.id)
    act(() => reopenedInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })))
    expect(onChange).toHaveBeenCalledExactlyOnceWith(2)
  })

  it("keeps composition confirmation and candidate Escape inside its own input", async () => {
    const container = document.body.appendChild(document.createElement("div"))
    const root = createRoot(container)
    roots.push(root)
    const onChange = vi.fn()
    act(() => root.render(<SearchableSelect items={["中文一", "中文二"]} value="中文一" onChange={onChange}
      getKey={(item) => item} getValue={(item) => item} getLabel={(item) => item} />))
    await act(async () => container.querySelector("button")!.click())
    const input = document.querySelector("input")!
    act(() => input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })))
    changeInput(input, "中文")
    const active = input.getAttribute("aria-activedescendant")
    for (const key of ["ArrowDown", "Enter", "Escape"]) {
      act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })))
    }
    expect(document.activeElement).toBe(input)
    expect(input.getAttribute("aria-activedescendant")).toBe(active)
    expect(onChange).not.toHaveBeenCalled()
    act(() => input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "中文" })))
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, bubbles: true, cancelable: true })))
    expect(onChange).not.toHaveBeenCalled()
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })))
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })))
    expect(onChange).toHaveBeenCalledExactlyOnceWith("中文二")
  })

  it("keeps independent selectors' search and highlighted value scoped to their popover", async () => {
    const container = document.body.appendChild(document.createElement("div"))
    const root = createRoot(container)
    roots.push(root)
    function Harness() {
      const [first, setFirst] = useState("Alpha")
      const [second, setSecond] = useState("Gamma")
      const props = { items: ["Alpha", "Beta", "Gamma"], getKey: (item: string) => item, getValue: (item: string) => item, getLabel: (item: string) => item }
      return <><SearchableSelect {...props} value={first} onChange={setFirst} searchAriaLabel="First search" />
        <SearchableSelect {...props} value={second} onChange={setSecond} searchAriaLabel="Second search" /></>
    }
    act(() => root.render(<Harness />))
    const [first, second] = container.querySelectorAll("button")
    await act(async () => first.click())
    const firstInput = document.querySelector<HTMLInputElement>('[aria-label="First search"]')!
    changeInput(firstInput, "beta")
    act(() => firstInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })))
    expect(first.textContent).toBe("Beta")
    await act(async () => second.click())
    const secondInput = document.querySelector<HTMLInputElement>('[aria-label="Second search"]')!
    expect(secondInput.value).toBe("")
    expect(document.querySelector('[role="option"][aria-selected="true"]')?.textContent).toBe("Gamma")
    expect(first.textContent).toBe("Beta")
    await act(async () => secondInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })))
    await act(async () => first.click())
    const reopened = document.querySelector<HTMLInputElement>('[aria-label="First search"]')!
    expect(reopened.value).toBe("")
    expect(document.querySelector('[role="option"][aria-selected="true"]')?.textContent).toBe("Beta")
  })

  it("focuses search, filters case-insensitively by label and extra terms, selects by non-string value, and resets query on reopen", async () => {
    const container = document.body.appendChild(document.createElement("div"))
    const root = createRoot(container)
    roots.push(root)
    const onChange = vi.fn()

    const items: Model[] = [
      { id: 1, name: "codex-auto-review", aliases: ["self-review", "auto"] },
      { id: 2, name: "glm-5.3", aliases: ["chat"] },
      { id: 3, name: "glm-5.3-dashscope", aliases: ["dashscope"] },
      { id: 4, name: "gpt-5.6-sol", aliases: ["openai", "sol"] },
    ]

    act(() =>
      root.render(
        <SearchableSelect<Model, number>
          items={items}
          value={3}
          onChange={onChange}
          getKey={(item) => String(item.id)}
          getValue={(item) => item.id}
          getLabel={(item) => item.name}
          getSearchTerms={(item) => item.aliases}
          placeholder="选择模型"
          searchPlaceholder="搜索模型…"
          clearLabel="清空模型搜索"
          emptyText="没有匹配的模型"
          menuPlacement="up"
          menuAlign="left"
          searchAriaLabel="搜索模型"
          optionListAriaLabel="模型列表"
          optionDataAttr="data-model-option"
        />,
      ),
    )

    const trigger = container.querySelector<HTMLButtonElement>("button")
    expect(trigger).not.toBeNull()
    expect(trigger?.textContent?.trim()).toContain("glm-5.3-dashscope")
    act(() => trigger?.click())
    await act(async () => {
      await Promise.resolve()
    })

    const search = document.querySelector<HTMLInputElement>(
      'input[aria-label="搜索模型"]',
    )
    expect(search).not.toBeNull()
    expect(document.activeElement).toBe(search)
    expect(document.getElementById(search!.getAttribute("aria-labelledby") ?? "")?.textContent).toBe("搜索模型")
    expect(document.querySelector('[role="listbox"]')?.getAttribute("aria-label")).toBe("模型列表")
    expect(visibleOptions("data-model-option")).toEqual([
      "codex-auto-review",
      "glm-5.3",
      "glm-5.3-dashscope",
      "gpt-5.6-sol",
    ])

    changeInput(search!, "GPT")
    expect(visibleOptions("data-model-option")).toEqual(["gpt-5.6-sol"])

    changeInput(search!, "alias:self-review")
    expect(visibleOptions("data-model-option")).toEqual([])
    expect(
      document.querySelector('[role="status"]')?.textContent,
    ).toContain("没有匹配的模型")

    changeInput(search!, "self-review")
    expect(visibleOptions("data-model-option")).toEqual(["codex-auto-review"])

    const option = document.querySelector<HTMLButtonElement>(
      "[data-model-option]",
    )
    act(() => option?.click())
    expect(onChange).toHaveBeenCalledExactlyOnceWith(1)
    expect(document.querySelector('input[aria-label="搜索模型"]')).toBeNull()

    act(() => trigger?.click())
    await act(async () => {
      await Promise.resolve()
    })
    expect(
      document.querySelector<HTMLInputElement>('input[aria-label="搜索模型"]')
        ?.value,
    ).toBe("")
  })

  it("renders the placeholder when the value does not match any item", async () => {
    const container = document.body.appendChild(document.createElement("div"))
    const root = createRoot(container)
    roots.push(root)

    act(() =>
      root.render(
        <SearchableSelect<{ id: string; name: string }, string>
          items={[{ id: "a", name: "Alpha" }]}
          value="missing"
          onChange={() => {}}
          getKey={(item) => item.id}
          getValue={(item) => item.id}
          getLabel={(item) => item.name}
          placeholder="未选择"
        />,
      ),
    )

    const trigger = container.querySelector<HTMLButtonElement>("button")
    expect(trigger?.textContent?.trim()).toContain("未选择")
  })

  it("clears the search query when the clear button is clicked", async () => {
    const container = document.body.appendChild(document.createElement("div"))
    const root = createRoot(container)
    roots.push(root)

    act(() =>
      root.render(
        <SearchableSelect<{ id: string; name: string }, string>
          items={[
            { id: "a", name: "Alpha" },
            { id: "b", name: "Beta" },
          ]}
          value="a"
          onChange={() => {}}
          getKey={(item) => item.id}
          getValue={(item) => item.id}
          getLabel={(item) => item.name}
        />,
      ),
    )

    act(() => container.querySelector<HTMLButtonElement>("button")?.click())
    await act(async () => {
      await Promise.resolve()
    })

    const search = document.querySelector<HTMLInputElement>("input")
    changeInput(search!, "beta")
    expect(visibleOptions()).toEqual(["Beta"])

    const clearButton = document.querySelector<HTMLButtonElement>(
      '[aria-label="清空搜索"]',
    )
    act(() => clearButton?.click())
    expect(search?.value).toBe("")
    expect(visibleOptions()).toEqual(["Alpha", "Beta"])
    expect(document.activeElement).toBe(search)
  })
})
