import { describe, expect, it, vi } from "vitest"
import { createRevealPlugin, MAX_REVEAL_CHUNKS, REVEAL_CHUNK_SIZE } from "./streamdownReveal"

const prose = (value: string) => ({
  type: "root", children: [{ type: "element", tagName: "p", children: [{ type: "text", value }] }],
})

describe("bounded prose reveal", () => {
  it("bounds a long CJK paragraph while preserving the exact Unicode source", () => {
    const source = "中".repeat(REVEAL_CHUNK_SIZE * (MAX_REVEAL_CHUNKS + 10))
    const tree = prose(source)
    createRevealPlugin("budget", true).plugin()(tree)
    const chunks = tree.children[0].children as unknown as { children: { value: string }[] }[]
    expect(chunks).toHaveLength(MAX_REVEAL_CHUNKS + 1)
    expect(chunks.map((chunk) => chunk.children[0].value).join("")).toBe(source)
  })

  it("never splits grapheme clusters at a chunk boundary", () => {
    const source = "文".repeat(31) + "👩🏽‍💻" + "e\u0301" + "🇨🇳"
    const tree = prose(source)
    createRevealPlugin("unicode", true).plugin()(tree)
    const chunks = tree.children[0].children as unknown as { children: { value: string }[] }[]
    expect(chunks.map((chunk) => chunk.children[0].value)).toEqual([
      "文".repeat(31) + "👩🏽‍💻", "e\u0301🇨🇳",
    ])
  })

  it("keeps the commit boundary stable across repeated render passes", () => {
    const reveal = createRevealPlugin("commit", false)
    const initial = prose("中".repeat(32))
    reveal.plugin()(initial)
    reveal.commit()
    const first = prose("中".repeat(32) + "追加")
    const repeated = prose("中".repeat(32) + "追加")
    reveal.plugin()(first)
    reveal.plugin()(repeated)
    expect(repeated).toEqual(first)
    reveal.commit()
    const revised = prose("A replacement of the old text")
    reveal.plugin()(revised)
    expect(JSON.stringify(revised)).not.toContain('data-assistant-reveal":"true')
    expect(createRevealPlugin("other", true).plugin.name).not.toBe(reveal.plugin.name)
  })

  it("renders plain text when native grapheme segmentation is unavailable", () => {
    vi.stubGlobal("Intl", { ...Intl, Segmenter: undefined })
    const tree = prose("正文👩🏽‍💻")
    const before = structuredClone(tree)
    createRevealPlugin("fallback", true).plugin()(tree)
    expect(tree).toEqual(before)
  })
})
