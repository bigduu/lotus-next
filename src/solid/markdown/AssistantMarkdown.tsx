import { createEffect, createMemo, createUniqueId, For, Show, untrack } from "solid-js"
import { Dynamic, type JSX } from "@solidjs/web"
import type { Element, RootContent } from "hast"
import { markdownTheme } from "@/lib/markdown/theme"
import { createRevealPlugin } from "@/lib/markdown/proseReveal"
import { cn } from "../../lib/utils"
import { CodeBlock } from "./CodeBlock"
import { InlineImage } from "./InlineImage"
import { MermaidBlock } from "./MermaidBlock"
import type { MermaidTheme } from "../../lib/mermaid/strictConfig"
import { attribute, contentText, parseAssistantMarkdown } from "./markdownTree"
import { englishMarkdownText, type MarkdownText } from "./text"
import { ProviderMarkdown } from "./ProviderMarkdown"
import "@/lib/markdown/layout.css"
import "./markdown.css"

export interface AssistantMarkdownProps {
  children: string
  class?: string
  isStreaming?: boolean
  /** The application owns external-link confirmation and navigation. */
  onOpenLink?: (url: string) => void
  onPreviewImage?: (src: string) => void
  /** Supply the bounded Bodhi image reader only when the host supports it. */
  readImage?: (path: string) => Promise<string>
  text?: MarkdownText
  theme?: MermaidTheme
}

type MarkdownActions = {
  openLink?: (url: string) => void
  previewImage?: (src: string) => void
  readImage?: (path: string) => Promise<string>
  text: MarkdownText
  theme: MermaidTheme
  idPrefix: string
}

const DATA_PARTS: Readonly<Record<string, string>> = {
  a: "link",
  code: "inline-code",
  strong: "strong",
  table: "table",
  tbody: "table-body",
  td: "table-cell",
  th: "table-header-cell",
  thead: "table-header",
  tr: "table-row",
}
const CONTENT_CLASSES: Readonly<Record<string, string>> = {
  blockquote: "border-muted-foreground/30",
  code: "rounded bg-muted px-1.5 py-0.5 font-mono text-sm",
  h1: "text-3xl font-semibold",
  h2: "text-2xl font-semibold",
  h3: "text-xl font-semibold",
  h4: "text-lg font-semibold",
  h5: "text-base font-semibold",
  h6: "text-sm font-semibold",
  li: "py-1 [&>p]:inline",
  ol: "list-inside list-decimal [li_&]:ps-6",
  table: "divide-y divide-border",
  tbody: "divide-y divide-border",
  td: "px-4 py-2 text-sm",
  th: "px-4 py-2 text-start text-sm font-semibold",
  thead: "bg-muted/80",
  ul: "list-inside list-disc [li_&]:ps-6",
}
const CONTENT_TAGS = new Set([
  "blockquote", "br", "code", "del", "em", "h1", "h2", "h3", "h4", "h5", "h6", "hr",
  "li", "ol", "p", "section", "strong", "sup", "table", "tbody", "td", "th", "thead", "tr", "ul",
])
const MAX_ENTERING_PROSE_BLOCKS = 12
const PROSE_BLOCK = "p,h1,h2,h3,h4,h5,h6,ul,ol,blockquote"

function revealEnteringProse(host: HTMLElement, seen: WeakSet<globalThis.Element>) {
  const children = Array.from(host.children)
  const document = host.ownerDocument
  const animate = children.length > 1 && !document.hidden && document.body.dataset.vdiSafe !== "true"
    && !host.closest("[inert]") && !document.defaultView?.matchMedia("(prefers-reduced-motion: reduce)").matches
  for (const [index, block] of children.entries()) {
    if (seen.has(block)) continue
    seen.add(block)
    // Newly placed blocks reveal as a unit. Only appends to an existing block use inline motion.
    for (const chunk of block.querySelectorAll<HTMLElement>('[data-assistant-reveal="true"]')) {
      chunk.style.animationName = "none"
    }
    if (!animate || index < children.length - MAX_ENTERING_PROSE_BLOCKS) continue
    if (!block.matches(PROSE_BLOCK)) continue
    const firstChunk = block.querySelector("[data-assistant-reveal-chunk]")
    if (!firstChunk) continue
    const target = block.querySelector("a,button,code,img,pre,table") ? firstChunk : block
    target.animate([{ opacity: 0.55 }, { opacity: 1 }], { duration: 140, easing: "ease-out" })
  }
}

function MarkdownChildren(props: {
  nodes: readonly RootContent[]
  actions: MarkdownActions
}) {
  return (
    <For each={props.nodes} keyed={false}>{(node) => (
      <Show
        when={(node().type === "element" ? node() : null) as Element | null}
        fallback={node().type === "text" ? (node() as Extract<RootContent, { type: "text" }>).value : null}
      >
        {(element) => <MarkdownElement node={element} actions={props.actions} />}
      </Show>
    )}</For>
  )
}

function MarkdownLink(props: { node: () => Element; actions: MarkdownActions }) {
  const href = () => attribute(props.node(), "href")
  const fragment = () => {
    const value = href()
    if (!value?.startsWith("#")) return undefined
    const properties = props.node().properties
    return "dataFootnoteRef" in properties || "dataFootnoteBackref" in properties
      ? `#${props.actions.idPrefix}user-content-${value.slice(1)}`
      : value
  }
  const openLink = () => {
    const value = href()
    if (value && !fragment()) props.actions.openLink?.(value)
  }
  return (
    <Show when={href()} fallback={<MarkdownChildren nodes={props.node().children} actions={props.actions} />}>
      <a
        href={fragment()}
        role="link"
        tabindex={!fragment() && props.actions.openLink ? 0 : undefined}
        title={attribute(props.node(), "title")}
        id={scopedAttribute(props, "id")}
        aria-describedby={scopedAttribute(props, "ariaDescribedBy")}
        aria-label={attribute(props.node(), "ariaLabel")}
        data-streamdown="link"
        class="cursor-pointer underline underline-offset-2"
        onClick={(event) => { if (!fragment()) { event.preventDefault(); openLink() } }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !fragment()) { event.preventDefault(); openLink() }
        }}
      >
        <MarkdownChildren nodes={props.node().children} actions={props.actions} />
      </a>
    </Show>
  )
}

function scopedAttribute(props: { node: () => Element; actions: MarkdownActions }, key: string) {
  const value = attribute(props.node(), key)
  return value?.split(" ").map((part) => `${props.actions.idPrefix}${part}`).join(" ")
}

function RevealChunk(props: { node: () => Element }) {
  let host!: HTMLSpanElement
  let text: Text | undefined
  const value = () => contentText(props.node())
  const revealOnMount = untrack(() => props.node().properties["data-assistant-reveal"] === "true")
  const finishReveal = (event: AnimationEvent) => {
    if (event.animationName === "assistant-prose-reveal") host.style.animationName = "none"
  }
  createEffect(value, (next) => {
    if (!text) {
      text = host.ownerDocument.createTextNode(next)
      host.prepend(text)
    } else if (next.startsWith(text.data)) {
      if (next.length > text.data.length) text.appendData(next.slice(text.data.length))
    } else text.data = next
  })

  return (
    <span
      ref={(element) => { host = element }}
      data-assistant-reveal-chunk="true"
      data-assistant-reveal={revealOnMount ? "true" : undefined}
      onAnimationEnd={finishReveal}
      onAnimationCancel={finishReveal}
    >
      <Show when={props.node().properties["data-assistant-reveal-tail"] === "true"}>
        <span aria-hidden="true" data-assistant-streaming-caret="" />
      </Show>
    </span>
  )
}

function MarkdownElement(props: { node: () => Element; actions: MarkdownActions }) {
  const tag = () => props.node().tagName
  const renderer = createMemo(() => {
    switch (tag()) {
      case "a": return MarkdownLink
      case "img": return ImageElement
      case "input": return CheckboxElement
      case "pre": return CodeElement
      case "span": return RevealElement
      case "table": return TableElement
      default: return ContentElement
    }
  })
  return <Dynamic component={renderer()} node={props.node} actions={props.actions} />
}

type ElementProps = { node: () => Element; actions: MarkdownActions }
function ImageElement(props: ElementProps) {
  return (
    <Show when={attribute(props.node(), "src")}>{(src) => (
      <InlineImage
        src={src()}
        alt={attribute(props.node(), "alt") ?? ""}
        readImage={props.actions.readImage}
        onPreviewImage={props.actions.previewImage}
        text={props.actions.text}
      />
    )}</Show>
  )
}
const CheckboxElement = (props: ElementProps) =>
  <input type="checkbox" checked={props.node().properties.checked === true} disabled />
const RevealElement = (props: ElementProps) => (
  <Show when={props.node().properties["data-assistant-reveal-chunk"] === "true"}
    fallback={<MarkdownChildren nodes={props.node().children} actions={props.actions} />}>
    <RevealChunk node={props.node} />
  </Show>
)
function CodeElement(props: ElementProps) {
  const source = () => props.node().children.find(
    (child): child is Element => child.type === "element" && child.tagName === "code",
  )
  const language = () => source()?.properties.className
  const tag = () => {
    const classes = language()
    const classNames = Array.isArray(classes) ? classes : String(classes ?? "").split(/\s+/)
    const matched = classNames.find((name) => String(name).startsWith("language-"))
    return String(matched ?? "").slice("language-".length)
  }
  const sourceText = () => contentText(source() ?? props.node())
  const code = () => sourceText().replace(/\n$/, "")
  const incomplete = () => props.node().properties["data-incomplete"] === true
  return (
    <Show when={tag().toLowerCase() === "mermaid"}
      fallback={<CodeBlock code={code()} language={tag()} incomplete={incomplete()} />}>
      <Show when={!incomplete()} fallback={
        <div aria-label={props.actions.text("mermaid_diagram_is_still_streaming_317ebd6c")}
          class="my-4 min-w-0 rounded-xl border bg-sidebar p-2" data-mermaid-state="incomplete" role="status">
          <div class="px-1 pb-2 font-mono text-xs text-muted-foreground">{tag()}</div>
          <pre class="overflow-x-auto whitespace-pre-wrap rounded-md bg-background p-3 font-mono text-xs [overflow-wrap:anywhere]">
            {code()}
          </pre>
        </div>
      }>
        <For each={[sourceText()]}>{(source) => (
          <MermaidBlock original={source} text={props.actions.text} theme={props.actions.theme} />
        )}</For>
      </Show>
    </Show>
  )
}
const TableElement = (props: ElementProps) => (
  <div class="my-4 min-w-0 rounded-lg border bg-sidebar p-2" data-streamdown="table-wrapper">
    <div class="rounded-md border bg-background">
      <ContentElement {...props} />
    </div>
  </div>
)

function ContentElement(props: ElementProps) {
  const tag = () => props.node().tagName as keyof JSX.IntrinsicElements
  const originalStart = () => Number(props.node().properties.start ?? 1)
  const align = () => {
    const value = attribute(props.node(), "align")
    return value === "left" || value === "center" || value === "right" ? value : undefined
  }
  return (
    <Show when={CONTENT_TAGS.has(tag())}
      fallback={<MarkdownChildren nodes={props.node().children} actions={props.actions} />}>
      <Dynamic
        component={tag()}
        class={cn(CONTENT_CLASSES[tag()], attribute(props.node(), "className"))}
        id={scopedAttribute(props, "id")}
        start={tag() === "ol" && Number.isSafeInteger(originalStart()) ? originalStart() : undefined}
        style={align() ? { "text-align": align() } : undefined}
        data-streamdown={DATA_PARTS[tag()]}
      >
        <MarkdownChildren nodes={props.node().children} actions={props.actions} />
      </Dynamic>
    </Show>
  )
}

export function MarkdownProse(props: AssistantMarkdownProps) {
  const idPrefix = `markdown-${createUniqueId()}-`
  const reveal = createRevealPlugin(idPrefix)
  const seen = new WeakSet<globalThis.Element>()
  let revealHost!: HTMLDivElement
  const nodes = createMemo(() => {
    const tree = parseAssistantMarkdown(props.children, !!props.isStreaming)
    if (props.isStreaming) reveal.plugin()(tree)
    return tree.children
  })
  createEffect(nodes, () => {
    reveal.commit()
    if (untrack(() => props.isStreaming)) revealEnteringProse(revealHost, seen)
  })

  const actions: MarkdownActions = {
    get openLink() { return props.onOpenLink },
    get previewImage() { return props.onPreviewImage },
    get readImage() { return props.readImage },
    get theme() { return props.theme ?? "light" },
    text: (key, values) => (props.text ?? englishMarkdownText)(key, values),
    idPrefix,
  }

  return (
    <div dir="auto" class={cn(
      "assistant-streamdown prose max-w-none min-w-0 space-y-0 font-normal text-foreground",
      "[overflow-wrap:anywhere] prose-p:my-2 prose-headings:mt-4 prose-headings:mb-2",
      "prose-a:text-primary prose-li:my-0.5",
      props.isStreaming && "assistant-streamdown-streaming",
      props.class,
    )} style={markdownTheme}>
      <div ref={(element) => { revealHost = element }} data-assistant-reveal-block="true" style={{ display: "contents" }}>
        <MarkdownChildren nodes={nodes()} actions={actions} />
      </div>
    </div>
  )
}

export function AssistantMarkdown(props: AssistantMarkdownProps) {
  return <ProviderMarkdown {...props} prose={MarkdownProse} text={props.text ?? englishMarkdownText} />
}
