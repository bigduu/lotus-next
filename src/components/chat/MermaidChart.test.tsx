import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

const { initializeMermaid, renderMermaid } = vi.hoisted(() => ({
  initializeMermaid: vi.fn(),
  renderMermaid: vi.fn(),
}))

vi.mock("mermaid", () => ({
  default: {
    initialize: initializeMermaid,
    render: renderMermaid,
  },
}))

import MermaidChart from "./MermaidChart"

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

async function mountChart(code: string): Promise<HTMLDivElement> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  mountedRoots.push(root)

  await act(async () => {
    root.render(<MermaidChart code={code} />)
    await Promise.resolve()
  })

  return container
}

afterEach(() => {
  for (const root of mountedRoots.splice(0)) {
    act(() => root.unmount())
  }
  document.body.replaceChildren()
})

describe("MermaidChart", () => {
  it("uses the trusted config and renders normal SVG output", async () => {
    renderMermaid.mockResolvedValueOnce({ svg: '<svg role="img"><text>Safe</text></svg>' })

    const container = await mountChart("flowchart LR\nA[Safe]")

    expect(initializeMermaid).toHaveBeenCalledWith(
      expect.objectContaining({
        securityLevel: "strict",
        htmlLabels: false,
        flowchart: { htmlLabels: false },
        theme: "dark",
      }),
    )
    expect(renderMermaid).toHaveBeenCalledWith(expect.stringMatching(/^mmd-\d+$/), "flowchart LR\nA[Safe]")
    expect(container.querySelector("svg")?.textContent).toBe("Safe")
  })

  it("falls back to escaped source when Mermaid rejects malformed input", async () => {
    const malformed = "flowchart LR\nA["
    renderMermaid.mockRejectedValueOnce(new Error("parse failed"))

    const container = await mountChart(malformed)

    expect(container.querySelector("pre")?.textContent).toBe(malformed)
    expect(container.querySelector("svg")).toBeNull()
  })
})
