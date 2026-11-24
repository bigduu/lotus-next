import { describe, expect, it } from "vitest"
import { getSchema } from "@tiptap/core"
import Document from "@tiptap/extension-document"
import Paragraph from "@tiptap/extension-paragraph"
import Text from "@tiptap/extension-text"
import HardBreak from "@tiptap/extension-hard-break"
import Mention from "@tiptap/extension-mention"
import Link from "@tiptap/extension-link"
import { composerDocument, composerText, isComposerLink } from "./composerDocument"

const schema = getSchema([Document, Paragraph, Text, HardBreak, Mention, Link])
describe("plain-text composer contract", () => {
  it.each(["", "\n", "\n\n", "  leading\tspace  \n\nlast\n", "中文 👩‍💻 @src/文件 @ one.ts (a)[b].md", "<script>unsafe</script> & **Markdown**", "https://example.com/a?q=中文#ok\nnext"])("round trips %j exactly without interpreting @text or HTML", (text) => {
    const document = composerDocument(text)
    expect(composerText(schema.nodeFromJSON(document))).toBe(text)
    expect(JSON.stringify(document)).not.toContain('"type":"mention"')
  })
  it("serializes selected atomic paths, hard breaks and clipboard slices exactly", () => {
    const node = schema.nodeFromJSON({ type: "doc", content: [{ type: "paragraph", content: [
      { type: "text", text: "Read " },
      { type: "mention", attrs: { id: "src/中文 @ file (v2)[test].ts" } },
      { type: "hardBreak" },
      { type: "text", text: "next" },
    ] }] })
    expect(composerText(node)).toBe("Read @src/中文 @ file (v2)[test].ts\nnext")
    expect(composerText(node.slice(6, 7).content)).toBe("@src/中文 @ file (v2)[test].ts")
  })
  it("only marks explicit HTTP(S) URLs with literal visible text", () => {
    const node = schema.nodeFromJSON(composerDocument("https://example.com/a, http://localhost:9562/ javascript:alert(1) mailto:a@b.com example.com ftp://example.com"))
    const links: string[] = []
    node.descendants((child) => { if (child.marks.some((m) => m.type.name === "link")) links.push(child.text!) })
    expect(links).toEqual(["https://example.com/a", "http://localhost:9562/"])
  })
  it.each(["javascript:alert(1)", "data:text/html,hi", "file:///tmp/a", "//example.com", "mailto:a@example.com", "https://bad host/a", "https://a\nb"])("rejects unsafe/non-http link %s", (url) => expect(isComposerLink(url)).toBe(false))
})
