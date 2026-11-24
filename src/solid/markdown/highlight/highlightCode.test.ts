import { describe, expect, it } from "vitest"
import { highlightCode, type HighlightedCode } from "./highlightCode"

const text = (lines: HighlightedCode) => lines.map((line) => line.map((token) => token.content).join("")).join("\n")

describe("Solid Markdown highlighting", () => {
  it("resolves aliases to the same block and retains source offsets and both color themes", async () => {
    const code = 'const value = "日本語"\n\tconsole.log(value)'
    const alias = highlightCode(code, " JS ")
    expect(highlightCode(code, "javascript")).toBe(alias)
    const lines = await alias
    expect(text(lines)).toBe(code)
    const first = lines[0][0]
    expect(first).toMatchObject({ content: "const", offset: 0 })
    expect(first.htmlStyle?.color ?? first.color).toMatch(/^#/)
    expect(first.htmlStyle?.["--shiki-dark"] ?? first.color).toMatch(/^#/)
    for (const token of lines.flat()) expect(code.slice(token.offset, token.offset + token.content.length)).toBe(token.content)
  })

  it("keeps blocks with identical edges and a changed middle distinct", async () => {
    const edge = `// ${"shared".repeat(30)}\n`
    const before = `${edge}const middle = "first"\n${edge}`
    const after = `${edge}const middle = "later"\n${edge}`
    const [original, edited] = await Promise.all([highlightCode(before, "ts"), highlightCode(after, "ts")])
    expect(text(original)).toBe(before)
    expect(text(edited)).toBe(after)
  })

  it("keeps full source text for a fence without a bundled grammar", async () => {
    const code = "<example>\n  未知言語\n"
    expect(text(await highlightCode(code, "not-a-real-language"))).toBe(code)
  })
})
