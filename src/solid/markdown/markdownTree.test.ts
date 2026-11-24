import type { Element, Root, RootContent } from "hast"
import { describe, expect, it } from "vitest"
import { contentText, parseAssistantMarkdown } from "./markdownTree"

function elements(tree: Root | Element, tag: string): Element[] {
  return tree.children.flatMap((node: RootContent) =>
    node.type === "element" ? [...(node.tagName === tag ? [node] : []), ...elements(node, tag)] : [],
  )
}

describe("Solid assistant Markdown parsing", () => {
  it("renders CJK emphasis and GFM while a response is streaming", () => {
    const tree = parseAssistantMarkdown([
      "这是**重点**，也是~~删除~~。",
      "",
      "- [x] 完成",
      "",
      "| 列 | 内容 |",
      "| --- | --- |",
      "| 中文 | 值",
    ].join("\n"), true)
    expect(elements(tree, "strong").map(contentText)).toEqual(["重点"])
    expect(elements(tree, "del").map(contentText)).toEqual(["删除"])
    expect(elements(tree, "input")[0]?.properties).toMatchObject({ type: "checkbox", checked: true, disabled: true })
    expect(elements(tree, "td").map(contentText)).toEqual(["中文", "值"])
  })

  it("reveals incomplete emphasis and links without publishing the partial URL", () => {
    const tree = parseAssistantMarkdown("This is **bold", true)
    expect(elements(tree, "strong").map(contentText)).toEqual(["bold"])
    const link = parseAssistantMarkdown("[Read](https://exa", true)
    expect(elements(link, "a")).toHaveLength(0)
    expect(elements(link, "p").map(contentText)).toEqual(["Read"])
  })

  it("distinguishes an actual closing fence from incomplete Mermaid text", () => {
    const incomplete = parseAssistantMarkdown("```mermaid\nflowchart LR\nA --> B", true)
    const complete = parseAssistantMarkdown("```mermaid\nflowchart LR\nA --> B\n```", true)
    const nested = parseAssistantMarkdown("> ~~~mermaid\n> flowchart LR\n> A --> B\n> ~~~", true)
    expect(elements(incomplete, "pre")[0]?.properties["data-incomplete"]).toBe(true)
    expect(elements(complete, "pre")[0]?.properties["data-incomplete"]).toBeUndefined()
    expect(elements(nested, "pre")[0]?.properties["data-incomplete"]).toBeUndefined()
  })

  it("drops raw HTML and denies unsupported href and src schemes", () => {
    const tree = parseAssistantMarkdown([
      '<img src="https://example.test/raw.png">',
      "",
      "[unsafe](javascript:example) [scheme-relative](//example.test/x) [web](https://example.test/x)",
      "",
      "![unsafe](data:image/svg+xml,diagram) ![local](file:///Users/example/diagram.png)",
    ].join("\n"), false)
    expect(elements(tree, "a").map((node) => node.properties.href)).toEqual([
      undefined, undefined, "https://example.test/x",
    ])
    expect(elements(tree, "img").map((node) => node.properties.src)).toEqual([
      undefined, "/__bodhi_local_image__/%2FUsers%2Fexample%2Fdiagram.png",
    ])
  })
})
