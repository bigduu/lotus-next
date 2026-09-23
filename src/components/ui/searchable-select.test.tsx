import { act } from "react"
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
