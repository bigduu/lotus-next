import { expect, it, vi } from "vitest"
import { themeStore } from "@shared/store/themeState"
import { renderPdfMarkdown } from "./pdfMarkdown"

const mermaid = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }))
vi.mock("mermaid", () => ({ default: mermaid }))

it("keeps a dimensionless strict Mermaid result as an isolated SVG image inside the PDF", async () => {
  const host = document.createElement("div")
  const previous = themeStore.getState().themeMode
  const source = "flowchart LR\nA[Safe PDF]"
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>Safe PDF</text></svg>'
  themeStore.setState({ themeMode: "dark" })
  mermaid.render.mockResolvedValueOnce({ svg })
  try {
    await renderPdfMarkdown(host, `\`\`\`mermaid\n${source}\n\`\`\``)
  } finally {
    themeStore.setState({ themeMode: previous })
  }

  expect(mermaid.initialize).toHaveBeenNthCalledWith(1, expect.objectContaining({
    startOnLoad: false, securityLevel: "strict", htmlLabels: false, flowchart: { htmlLabels: false }, theme: "default",
  }))
  expect(mermaid.render).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/^solid-export-diagram-\d+$/), source)
  expect(mermaid.initialize).toHaveBeenNthCalledWith(2, expect.objectContaining({ securityLevel: "strict", theme: "dark" }))
  expect(host.querySelector("[data-mermaid-loading]")).toBeNull()
  expect(host.querySelector("svg")).toBeNull()
  const preview = host.querySelector("img")
  expect(preview?.getAttribute("alt")).toBe("Mermaid diagram")
  expect(preview?.getAttribute("src")).toBe(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`)
})
