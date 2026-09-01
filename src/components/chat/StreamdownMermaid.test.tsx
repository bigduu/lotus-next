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
        theme: "dark",
      }),
    )
    expect(mermaidPluginState.config).toMatchObject({ securityLevel: "strict", theme: "dark" })
    expect(renderMermaid).toHaveBeenCalledWith(
      expect.stringMatching(/^streamdown-mermaid-\d+$/),
      "flowchart LR\nA[Safe chart]",
    )
    const chart = container.querySelector<HTMLElement>('[data-mermaid-state="ready"]')
    expect(chart?.getAttribute("role")).toBe("img")
    expect(chart?.getAttribute("aria-label")).toBe("Mermaid 图表")
    expect(chart?.querySelector("svg")?.textContent).toBe("Safe chart")
  })

  it("shows invalid source as escaped, accessible text", async () => {
    const malformed = 'flowchart LR\nA[<img src=x onerror="alert(1)">'
    renderMermaid.mockRejectedValueOnce(new Error("parse failed"))
    const { container } = await mountMermaid(malformed)

    const fallback = container.querySelector<HTMLElement>('[data-mermaid-state="error"]')
    expect(fallback?.getAttribute("role")).toBe("alert")
    expect(fallback?.getAttribute("aria-live")).toBe("polite")
    expect(fallback?.querySelector("pre")?.textContent).toBe(malformed)
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
})
