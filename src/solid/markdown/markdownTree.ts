import type { Element, Root, RootContent } from "hast"
import rehypeSanitize from "rehype-sanitize"
import remend from "remend"
import remarkCjkFriendly from "remark-cjk-friendly"
import remarkCjkStrikethrough from "remark-cjk-friendly-gfm-strikethrough"
import remarkGfm from "remark-gfm"
import remarkParse from "remark-parse"
import remarkRehype from "remark-rehype"
import { unified } from "unified"
import { remarkLocalRasterImages, safeAssistantUrlTransform } from "@/lib/assistantMarkdownSafety"

type MarkdownNode = { type: string; url?: string; value?: string; children?: MarkdownNode[] }
const cjkPunctuation = /[。．，、？！：；（）【】「」『』〈〉《》]/u
const autolinkScheme = /^(?:https?:\/\/|mailto:|www\.)/i

/** GFM autolinks can absorb adjacent CJK punctuation and prose. */
function remarkCjkAutolinks() {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      const children = node.children
      if (!children) return
      for (let index = 0; index < children.length; index += 1) {
        const child = children[index]
        const label = child.children?.length === 1 ? child.children[0] : null
        if (child.type === "link" && child.url && label?.type === "text" && label.value === child.url && autolinkScheme.test(child.url)) {
          const split = child.url.search(cjkPunctuation)
          if (split > 0) {
            const url = child.url.slice(0, split)
            children.splice(index, 1, { ...child, url, children: [{ type: "text", value: url }] },
              { type: "text", value: child.url.slice(split) })
            index += 1
            continue
          }
        }
        visit(child)
      }
    }
    visit(tree)
  }
}

const parser = unified()
  .use(remarkParse)
  .use(remarkCjkFriendly)
  .use(remarkGfm)
  .use(remarkCjkAutolinks)
  .use(remarkCjkStrikethrough)
  .use(remarkLocalRasterImages)
  .use(remarkRehype, { clobberPrefix: "" })
  .use(rehypeSanitize)
  .freeze()

export function contentText(node: Element): string {
  return node.children.map((child) =>
    child.type === "text" ? child.value : child.type === "element" ? contentText(child) : "",
  ).join("")
}

function endsWithClosingFence(node: Element, source: string): boolean {
  const start = node.position?.start.offset ?? source.length
  const end = node.position?.end.offset ?? source.length
  const lines = source.slice(start, end).trimEnd().split(/\r?\n/)
  const opening = /^(?:`{3,}|~{3,})/.exec(lines[0])?.[0]
  if (!opening) return true
  if (lines.length < 2) return false

  // HAST positions include a real closing fence if the Markdown parser found
  // one. Strip enclosing blockquote markers before checking the delimiter.
  const tail = lines.at(-1)!.replace(/^(?:[ \t]*>[ \t]?)+/, "").trim()
  const codeTail = contentText(node).trimEnd().split(/\r?\n/).at(-1)?.trim()
  return tail !== codeTail && tail.length >= opening.length &&
    [...tail].every((character) => character === opening[0])
}

export function parseAssistantMarkdown(source: string, streaming: boolean): Root {
  const markdown = streaming ? remend(source, { katex: false, linkMode: "text-only" }) : source
  const tree = parser.runSync(parser.parse(markdown))

  const protect = (node: RootContent): void => {
    if (node.type !== "element") return
    for (const name of ["href", "src"] as const) {
      const value = node.properties[name]
      if (typeof value !== "string") continue
      const safe = safeAssistantUrlTransform(value, name)
      if (safe) node.properties[name] = safe
      else delete node.properties[name]
    }

    if (streaming && node.tagName === "pre" && !endsWithClosingFence(node, markdown)) {
      node.properties["data-incomplete"] = true
    }
    node.children.forEach(protect)
  }
  tree.children.forEach(protect)
  return tree
}

export function attribute(node: Element, key: string): string | undefined {
  const value = node.properties[key]
  return typeof value === "string" ? value : Array.isArray(value) ? value.join(" ") : undefined
}
