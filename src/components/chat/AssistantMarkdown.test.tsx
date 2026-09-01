import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("./LazyAssistantMarkdown", () => ({
  LazyAssistantMarkdown: ({
    children,
    isStreaming,
  }: {
    children: string
    isStreaming: boolean
  }) => (
    <div data-assistant-markdown data-streaming={String(isStreaming)}>
      {children}
    </div>
  ),
}))

vi.mock("./BuiltinToolBlock", () => ({
  BuiltinToolBlock: ({ name, body }: { name: string; body: string }) => (
    <div data-body={body} data-provider-tool={name} />
  ),
}))

import { AssistantMarkdown } from "./AssistantMarkdown"

const mountedRoots: Root[] = []
const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

beforeAll(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => {
  Reflect.deleteProperty(reactActEnvironment, "IS_REACT_ACT_ENVIRONMENT")
})

afterEach(() => {
  for (const root of mountedRoots.splice(0)) act(() => root.unmount())
  document.body.replaceChildren()
})

function renderAssistant(children: string, isStreaming: boolean): HTMLDivElement {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  mountedRoots.push(root)
  act(() => root.render(<AssistantMarkdown isStreaming={isStreaming}>{children}</AssistantMarkdown>))
  return container
}

describe("AssistantMarkdown provider preprocessing", () => {
  it("keeps a complete provider marker in the existing tool UI and only streams the tail", () => {
    const marker = [
      "Before",
      "",
      "**🌐 Z.ai Built-in Tool: analyze_image**",
      "**Input:** hidden input",
      "**Output:** safe result",
      "",
      "After **still streaming",
    ].join("\n")

    const container = renderAssistant(marker, true)
    const markdown = [...container.querySelectorAll<HTMLElement>("[data-assistant-markdown]")]

    expect(container.querySelector('[data-provider-tool="analyze_image"]')).not.toBeNull()
    expect(markdown.map((node) => node.textContent)).toEqual(["Before", "After **still streaming"])
    expect(markdown.map((node) => node.dataset.streaming)).toEqual(["false", "true"])
    expect(markdown.some((node) => node.textContent?.includes("Built-in Tool"))).toBe(false)
  })

  it("defers a partial streaming provider block instead of exposing its marker or input", () => {
    const partial = [
      "Stable introduction",
      "",
      "**🌐 Z.ai Built-in Tool: web_search**",
      "**Input:** signed-secret-url",
    ].join("\n")

    const container = renderAssistant(partial, true)
    const pending = container.querySelector<HTMLElement>('[data-provider-tool-state="streaming"]')
    const markdown = container.querySelector<HTMLElement>("[data-assistant-markdown]")

    expect(pending?.getAttribute("role")).toBe("status")
    expect(pending?.textContent).toContain("web_search")
    expect(markdown?.textContent).toBe("Stable introduction")
    expect(markdown?.dataset.streaming).toBe("false")
    expect(container.textContent).not.toContain("Built-in Tool")
    expect(container.textContent).not.toContain("signed-secret-url")
  })

  it.each([
    "**🌐 Z.ai Buil",
    "**🌐 Z.ai Built-in Tool:",
    "**🌐 Z.ai Built-in Tool: web_se",
  ])("does not leak a token-partial decorated provider header: %s", (partialHeader) => {
    const container = renderAssistant(`Stable introduction\n\n${partialHeader}`, true)
    const pending = container.querySelector<HTMLElement>('[data-provider-tool-state="streaming"]')
    const markdown = container.querySelector<HTMLElement>("[data-assistant-markdown]")

    expect(pending?.getAttribute("role")).toBe("status")
    expect(markdown?.textContent).toBe("Stable introduction")
    expect(markdown?.dataset.streaming).toBe("false")
    expect(container.textContent).not.toContain(partialHeader)
  })

  it("leaves a similar but incomplete marker as ordinary Markdown once persisted", () => {
    const malformed = "Built-in Tool: example\nInput without a complete Output marker"
    const container = renderAssistant(malformed, false)

    expect(container.querySelector('[data-provider-tool-state="streaming"]')).toBeNull()
    expect(container.querySelector("[data-assistant-markdown]")?.textContent).toBe(malformed)
  })

  it("does not hide undecorated prose that merely mentions a built-in tool while streaming", () => {
    const prose = "Documentation may say Built-in Tool: example without invoking one."
    const container = renderAssistant(prose, true)

    expect(container.querySelector('[data-provider-tool-state="streaming"]')).toBeNull()
    expect(container.querySelector("[data-assistant-markdown]")?.textContent).toBe(prose)
  })
})
