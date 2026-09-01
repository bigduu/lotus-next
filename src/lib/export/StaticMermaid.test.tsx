import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const { renderMermaid } = vi.hoisted(() => ({
  renderMermaid: vi.fn(),
}))

vi.mock("mermaid", () => ({
  default: {
    render: renderMermaid,
  },
}))

import StaticMermaid from "./StaticMermaid"

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

beforeAll(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => {
  Reflect.deleteProperty(reactActEnvironment, "IS_REACT_ACT_ENVIRONMENT")
})

describe("StaticMermaid", () => {
  it("falls back to the strict-rendered SVG when PDF rasterization has no dimensions", async () => {
    renderMermaid.mockResolvedValueOnce({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>Safe PDF</text></svg>',
    })
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(<StaticMermaid code="flowchart LR\nA[Safe PDF]" />)
      await Promise.resolve()
    })

    const fallback = container.querySelector('[data-mermaid-loading="false"]')
    expect(fallback?.querySelector("svg")?.textContent).toBe("Safe PDF")
    expect(fallback?.querySelector("img")).toBeNull()

    act(() => root.unmount())
    container.remove()
  })
})
