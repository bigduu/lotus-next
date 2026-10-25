import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const { mermaidPluginState, initializeMermaid, renderMermaid } = vi.hoisted(() => ({
  mermaidPluginState: { config: undefined as unknown },
  initializeMermaid: vi.fn(),
  renderMermaid: vi.fn(),
}))

vi.mock("@streamdown/mermaid", () => ({
  createMermaidPlugin: (options: { config: unknown }) => {
    mermaidPluginState.config = options.config
    return {
      getMermaid(config: unknown) {
        initializeMermaid(config)
        return { render: renderMermaid }
      },
    }
  },
}))

import StreamdownMermaid from "./StreamdownMermaid"
import { useThemeStore } from "@shared/store/themeStore"

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

beforeEach(() => {
  initializeMermaid.mockReset()
  renderMermaid.mockReset()
  useThemeStore.setState({ themeMode: "light" })
})

afterEach(() => {
  for (const root of mountedRoots.splice(0)) act(() => root.unmount())
  document.body.replaceChildren()
})

async function mountMermaid(code: string): Promise<{ container: HTMLDivElement; root: Root }> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  mountedRoots.push(root)

  await act(async () => {
    root.render(<StreamdownMermaid code={code} />)
    await Promise.resolve()
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
  })
  return { container, root }
}

describe("StreamdownMermaid", () => {
  it("renders completed source with the exact shared strict app policy", async () => {
    renderMermaid.mockResolvedValueOnce({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>Safe chart</text></svg>',
    })
    const { container } = await mountMermaid("flowchart LR\nA[Safe chart]")

    expect(initializeMermaid).toHaveBeenCalledWith(
      expect.objectContaining({
        startOnLoad: false,
        securityLevel: "strict",
        htmlLabels: false,
        flowchart: { htmlLabels: false },
        theme: "default",
      }),
    )
    expect(mermaidPluginState.config).toMatchObject({ securityLevel: "strict", htmlLabels: false })
    expect(renderMermaid).toHaveBeenCalledWith(
      expect.stringMatching(/^streamdown-mermaid-\d+$/),
      "flowchart LR\nA[Safe chart]",
    )
    const chart = container.querySelector<HTMLElement>('[data-mermaid-state="ready"]')
    expect(chart?.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Mermaid 图表")
    expect(chart?.querySelector("svg")?.textContent).toBe("Safe chart")
  })

  it("shows invalid source as escaped, accessible text", async () => {
    const malformed = 'flowchart LR\nA[<img src=x onerror="alert(1)">'
    renderMermaid.mockRejectedValueOnce(new Error("parse failed"))
    const { container } = await mountMermaid(malformed)

    const fallback = container.querySelector<HTMLElement>('[data-mermaid-state="error"]')
    expect(fallback?.querySelector('[role="alert"]')?.textContent).toBe("Mermaid 图表无法渲染")
    expect(fallback?.querySelector("[data-mermaid-source]")?.textContent).toBe(malformed)
    expect(fallback?.querySelector("img")).toBeNull()
    expect(fallback?.querySelector("script")).toBeNull()
    expect(fallback?.textContent).toContain("parse failed")
  })

  it("hides an earlier SVG immediately when the source changes", async () => {
    renderMermaid.mockResolvedValueOnce({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>Old chart</text></svg>',
    })
    const { container, root } = await mountMermaid("flowchart LR\nA[Old]")
    expect(container.querySelector("svg")?.textContent).toBe("Old chart")

    renderMermaid.mockReturnValueOnce(new Promise(() => undefined))
    act(() => root.render(<StreamdownMermaid code="flowchart LR\nB[New]" />))

    expect(container.querySelector("svg")).toBeNull()
    expect(container.querySelector('[data-mermaid-state="loading"]')).not.toBeNull()
  })

  it("rerenders existing diagrams with the resolved theme and ignores a stale themed SVG", async () => {
    renderMermaid.mockResolvedValueOnce({ svg: '<svg><text>Light chart</text></svg>' })
    const { container } = await mountMermaid("flowchart LR\nA[Theme]")
    let finishDark!: (value: { svg: string }) => void
    renderMermaid.mockReturnValueOnce(new Promise((resolve) => { finishDark = resolve }))
    act(() => useThemeStore.setState({ themeMode: "dark" }))
    expect(container.querySelector("svg")).toBeNull()
    expect(initializeMermaid).toHaveBeenLastCalledWith(expect.objectContaining({ theme: "dark", securityLevel: "strict" }))
    renderMermaid.mockResolvedValueOnce({ svg: '<svg><text>Current light chart</text></svg>' })
    await act(async () => useThemeStore.setState({ themeMode: "light" }))
    await act(async () => finishDark({ svg: '<svg><text>Stale dark chart</text></svg>' }))
    expect(container.querySelector("svg")?.textContent).toBe("Current light chart")
  })

  it("retries failed rendering and repairs only the local preview, with restore and source-change reset", async () => {
    const original = "flowchart LR\nA[Broken"
    renderMermaid.mockRejectedValueOnce(new Error("Visible parse error"))
    const { container, root } = await mountMermaid(original)
    const button = (label: string) => [...container.querySelectorAll("button")].find((element) => element.textContent === label)!
    renderMermaid.mockRejectedValueOnce(new Error("Still invalid"))
    await act(async () => button("重新渲染").click())
    expect(renderMermaid).toHaveBeenLastCalledWith(expect.any(String), original)
    expect(container.textContent).toContain("Still invalid")
    act(() => button("编辑源码").click())
    const editor = container.querySelector("textarea")!
    for (const ime of [{ isComposing: true }, { keyCode: 229 }]) {
      act(() => editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, ...ime })))
      expect(container.querySelector("textarea")).toBe(editor)
    }
    const repaired = "flowchart LR\nA[Repaired] --> B[Done]"
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(editor, repaired)
      editor.dispatchEvent(new Event("input", { bubbles: true }))
    })
    renderMermaid.mockResolvedValueOnce({ svg: '<svg><text>Repaired chart</text></svg>' })
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
    expect(renderMermaid).toHaveBeenLastCalledWith(expect.any(String), repaired)
    expect(container.querySelector("svg")?.textContent).toBe("Repaired chart")
    expect(container.querySelector("textarea")).toBeNull()
    renderMermaid.mockRejectedValueOnce(new Error("Original still invalid"))
    await act(async () => button("还原原图").click())
    expect(container.querySelector("[data-mermaid-source]")?.textContent).toBe(original)
    renderMermaid.mockResolvedValueOnce({ svg: '<svg><text>Updated message</text></svg>' })
    await act(async () => root.render(<StreamdownMermaid code="flowchart LR\nA[Updated message]" />))
    expect(container.querySelector("svg")?.textContent).toBe("Updated message")
    expect(container.textContent).not.toContain("还原原图")
  })
})
