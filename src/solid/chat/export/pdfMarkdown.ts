import { uiText } from "@shared/i18n/text"
import type { Element, RootContent } from "hast"
import rehypeSanitize from "rehype-sanitize"
import remarkGfm from "remark-gfm"
import remarkParse from "remark-parse"
import remarkRehype from "remark-rehype"
import { unified } from "unified"
import { safeAssistantUrlTransform } from "@/components/chat/streamdownConfig"
import { attribute, contentText } from "../../markdown/markdownTree"
import { renderExportMermaid } from "../../markdown/renderMermaid"
import { rasterizeMermaid } from "./rasterizeMermaid"

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkRehype).use(rehypeSanitize).freeze()
const tags = new Set([
  "a", "blockquote", "br", "code", "del", "em", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "img", "input",
  "li", "ol", "p", "section", "strong", "sup", "table", "tbody", "td", "th", "thead", "tr", "ul",
])
const attributes = [
  ["alt", "alt"], ["title", "title"], ["id", "id"], ["className", "class"],
  ["ariaDescribedBy", "aria-describedby"], ["ariaLabel", "aria-label"],
  ["dataFootnotes", "data-footnotes"], ["dataFootnoteRef", "data-footnote-ref"],
  ["dataFootnoteBackref", "data-footnote-backref"],
] as const

type Diagram = { host: HTMLElement; source: string }

/** Build only sanitized, explicitly supported DOM nodes from a static export. */
function appendNodes(parent: Node, children: readonly RootContent[], diagrams: Diagram[]) {
  for (const node of children) {
    if (node.type === "text") parent.appendChild(document.createTextNode(node.value))
    if (node.type !== "element") continue
    if (node.tagName === "pre") {
      appendCodeBlock(parent, node, diagrams)
      continue
    }
    if (!tags.has(node.tagName)) {
      appendNodes(parent, node.children, diagrams)
      continue
    }
    const element = document.createElement(node.tagName)
    const properties = node.properties
    for (const [from, to] of attributes) {
      const value = attribute(node, from)
      if (value !== undefined) element.setAttribute(to, value)
    }
    if (node.tagName === "input") {
      const input = element as HTMLInputElement
      input.type = "checkbox"
      input.checked = properties.checked === true
      input.disabled = true
    }
    if (node.tagName === "ol" && typeof properties.start === "number") element.setAttribute("start", String(properties.start))
    if ((node.tagName === "td" || node.tagName === "th") && typeof properties.align === "string") {
      element.setAttribute("align", properties.align)
    }
    const target = node.tagName === "img" ? "src" : node.tagName === "a" ? "href" : null
    if (target) {
      const url = attribute(node, target)
      const safe = url ? safeAssistantUrlTransform(url, target, node) : null
      if (safe) element.setAttribute(target, safe)
    }
    appendNodes(element, node.children, diagrams)
    parent.appendChild(element)
  }
}

function appendCodeBlock(parent: Node, block: Element, diagrams: Diagram[]) {
  const code = block.children.find((entry): entry is Element => entry.type === "element" && entry.tagName === "code")
  const wrapper = document.createElement("div")
  wrapper.className = "pdf-pre"
  parent.appendChild(wrapper)
  if (!(code && attribute(code, "className")?.split(/\s+/).includes("language-mermaid"))) {
    appendNodes(wrapper, block.children, diagrams)
    return
  }
  const diagram = document.createElement("div")
  diagram.dataset.mermaidLoading = "true"
  diagram.style.minHeight = "24px"
  diagrams.push({ host: diagram, source: contentText(code).replace(/\n$/, "") })
  wrapper.append(diagram)
}

function showFallback({ host, source }: Diagram, error: unknown) {
  const pre = document.createElement("pre")
  Object.assign(pre.style, {
    border: "1px solid #d9d9d9", borderRadius: "8px", padding: "12px", background: "#fafafa",
    color: "#1f1f1f", whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: "12px",
  })
  const details = error instanceof Error ? error.message : String(error)
  pre.textContent = uiText("could_not_render_mermaid_5386be07", { v0: details, v1: source })
  host.replaceWith(pre)
}

async function renderDiagram(diagram: Diagram, signal: AbortSignal) {
  try {
    const svg = await renderExportMermaid(diagram.source, signal)
    const rendered = await rasterizeMermaid(svg, signal)
    signal.throwIfAborted()
    const image = document.createElement("img")
    image.src = rendered.pngUrl ?? rendered.svgUrl
    image.alt = "Mermaid diagram"
    Object.assign(image.style, { maxWidth: "100%", height: "auto", display: "block" })
    if (rendered.width) image.style.width = `${rendered.width}px`
    const { host } = diagram
    host.style.minHeight = ""
    host.style.margin = "8px 0"
    if (rendered.pngUrl) host.dataset.mermaidLoading = "false"
    else delete host.dataset.mermaidLoading
    host.replaceChildren(image)
  } catch (error) {
    if (!signal.aborted) showFallback(diagram, error)
  }
}

export async function renderPdfMarkdown(host: HTMLElement, markdown: string): Promise<void> {
  const tree = parser.runSync(parser.parse(markdown))
  const diagrams: Diagram[] = []
  appendNodes(host, tree.children, diagrams)
  if (!diagrams.length) return

  const controller = new AbortController()
  let timer: number | undefined
  try {
    const deadline = new Promise<void>((resolve) => {
      timer = window.setTimeout(() => {
        controller.abort()
        for (const diagram of diagrams) {
          if (diagram.host.dataset.mermaidLoading === "true") {
            showFallback(diagram, uiText("could_not_render_mermaid_diagram_c26105d4"))
          }
        }
        resolve()
      }, 6_000)
    })
    await Promise.race([Promise.all(diagrams.map((diagram) => renderDiagram(diagram, controller.signal))), deadline])
  } finally {
    window.clearTimeout(timer)
  }
}
