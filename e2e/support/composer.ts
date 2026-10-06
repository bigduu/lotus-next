import { expect, type Locator } from "@playwright/test"

/** Read the user's plain text, retaining whitespace and hard breaks exactly. */
export async function composerText(editor: Locator): Promise<string> {
  return editor.evaluate((element) => {
    type TextNode = {
      nodeType: number
      nodeName: string
      textContent: string | null
      childNodes: ArrayLike<TextNode>
      getAttribute?: (name: string) => string | null
    }
    const text = (node: TextNode): string => {
      if (node.nodeType === 3) return node.textContent ?? ""
      // ProseMirror's final BR is a caret placeholder, not a draft newline.
      if (node.nodeName === "BR") return node.getAttribute?.("class")?.includes("ProseMirror-trailingBreak") ? "" : "\n"
      return Array.from(node.childNodes, text).join("")
    }
    return Array.from(element.childNodes, text).join("\n")
  })
}

export async function expectComposerText(editor: Locator, expected: string): Promise<void> {
  await expect.poll(() => composerText(editor)).toBe(expected)
}
