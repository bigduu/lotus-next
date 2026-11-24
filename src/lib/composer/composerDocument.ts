import type { JSONContent } from "@tiptap/core"
import { Slice, type Node as ProseMirrorNode, type Fragment, type Schema } from "@tiptap/pm/model"
import { find } from "linkifyjs"

/** The wire/store contract remains plain text. Never infer mentions from @text. */
export function isComposerLink(url: string): boolean {
  if (!/^https?:\/\//i.test(url) || Array.from(url).some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)) return false
  try {
    const parsed = new URL(url)
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && !!parsed.hostname
  } catch {
    return false
  }
}

export function composerDocument(text: string): JSONContent {
  return {
    type: "doc",
    content: text.replace(/\r\n?/g, "\n").split("\n").map((line) => {
      const content: JSONContent[] = []
      let offset = 0
      for (const match of find(line, "url")) {
        if (!isComposerLink(match.value)) continue
        if (match.start > offset) content.push({ type: "text", text: line.slice(offset, match.start) })
        content.push({ type: "text", text: match.value, marks: [{ type: "link", attrs: { href: match.value } }] })
        offset = match.end
      }
      if (offset < line.length) content.push({ type: "text", text: line.slice(offset) })
      return { type: "paragraph", content }
    }),
  }
}

/** Include atomic references and exact paragraph/soft line breaks in copy/send. */
export function composerText(node: ProseMirrorNode | Fragment): string {
  return node.textBetween(0, "type" in node ? node.content.size : node.size, "\n", (leaf) => {
    if (leaf.type.name === "mention") return `@${leaf.attrs.id}`
    if (leaf.type.name === "hardBreak") return "\n"
    return ""
  })
}

/** Open block edges merge pasted paragraphs into the current textblock. */
export function composerSlice(text: string, schema: Schema): Slice {
  return new Slice(schema.nodeFromJSON(composerDocument(text)).content, 1, 1)
}
