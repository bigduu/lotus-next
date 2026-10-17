import { expect, type Locator, type Page } from "@playwright/test"

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

/** Reveal low-frequency controls using the measured pane layout, not viewport breakpoints. */
export async function revealComposerSettings(page: Page): Promise<void> {
  const column = page.locator("[data-composer-column]").first()
  await expect(column).toBeVisible()
  // ResizeObserver has to measure the real pane before the responsive branch settles.
  await expect.poll(() => column.evaluate((element) => {
    const width = element.getBoundingClientRect().width
    return width > 0 && element.getAttribute("data-composer-compact") === String(width < 600)
  })).toBe(true)
  if (await column.getAttribute("data-composer-compact") === "true") {
    const more = column.getByRole("button", { name: /^(More|更多)$/ })
    if (await more.getAttribute("aria-expanded") !== "true") await more.click()
    await expect(page.getByRole("dialog", { name: /^(More|更多)$/ })).toBeVisible()
  }
}
