import { uiText, useUiLocale } from "@shared/i18n/ui"
import { lazy, Suspense, useLayoutEffect, useMemo, useRef, type RefObject } from "react"
import { cjk } from "@streamdown/cjk"
import rehypeSanitize from "rehype-sanitize"
import {
  defaultRehypePlugins,
  defaultRemarkPlugins,
  Streamdown,
  type CustomRendererProps,
  type PluginConfig,
} from "streamdown"
import "streamdown/styles.css"
import "./StreamdownLayout.css"

import { markdownTheme } from "./markdownTheme"
import { cn } from "@/lib/utils"
import { InlineImage } from "./InlineImage"
import { ExternalLinkDialog } from "./ExternalLinkDialog"
import { StreamingReveal, StreamingRevealBlock, StreamingRevealSpan } from "./StreamingReveal"
import {
  lazyCodePlugin,
  remarkLocalRasterImages,
  safeAssistantUrlTransform,
  STREAMDOWN_THEMES,
} from "./streamdownConfig"

const COMPACT_CODE_BLOCK_STYLES = {
  block: { gap: "0.25rem", marginBlock: "0.5rem", padding: "0.375rem" },
  body: { fontSize: "0.875rem", fontWeight: "400", lineHeight: "1.55", padding: "0.625rem 0.75rem" },
  header: { fontSize: "0.75rem", height: "1.25rem", lineHeight: "1rem" },
  source: {
    background: "transparent",
    fontSize: "inherit",
    fontWeight: "inherit",
    lineHeight: "inherit",
    margin: "0",
    padding: "0",
  },
} as const

function applyCompactCodeBlockStyles(root: HTMLElement): void {
  for (const block of root.querySelectorAll<HTMLElement>('[data-streamdown="code-block"]')) {
    Object.assign(block.style, COMPACT_CODE_BLOCK_STYLES.block)
  }
  for (const header of root.querySelectorAll<HTMLElement>(
    '[data-streamdown="code-block-header"]',
  )) {
    Object.assign(header.style, COMPACT_CODE_BLOCK_STYLES.header)
  }
  for (const body of root.querySelectorAll<HTMLElement>('[data-streamdown="code-block-body"]')) {
    Object.assign(body.style, COMPACT_CODE_BLOCK_STYLES.body)
    for (const source of body.querySelectorAll<HTMLElement>("pre, code")) {
      Object.assign(source.style, COMPACT_CODE_BLOCK_STYLES.source)
    }
  }
}

function useCompactCodeBlocks(
  hostRef: RefObject<HTMLDivElement | null>,
): void {
  useUiLocale()
  useLayoutEffect(() => {
    const root = hostRef.current?.querySelector<HTMLElement>(".assistant-streamdown")
    if (!root) return

    // Streamdown does not forward a style prop. Set the palette on its own prose
    // root; an ancestor cannot override typography's locally declared variables.
    for (const [name, value] of Object.entries(markdownTheme)) root.style.setProperty(name, String(value))
    applyCompactCodeBlockStyles(root)
    const observer = new MutationObserver(() => applyCompactCodeBlockStyles(root))
    observer.observe(root, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [hostRef])
}

const LazyStreamdownMermaid = lazy(() => import("./StreamdownMermaid"))

/**
 * Streamdown 2.6's built-in Mermaid path may render a remended, unclosed fence.
 * A custom renderer receives the real fence state, so incomplete source stays
 * escaped and does not even load Mermaid until the closing fence arrives.
 */
export function DeferredMermaidRenderer({
  code,
  isIncomplete,
  language,
}: CustomRendererProps) {
  useUiLocale()
  if (isIncomplete) {
    return (
      <div
        aria-label={uiText("mermaid_diagram_is_still_streaming_317ebd6c")}
        className="my-4 min-w-0 rounded-xl border bg-sidebar p-2"
        data-mermaid-state="incomplete"
        role="status"
      >
        <div className="px-1 pb-2 font-mono text-xs text-muted-foreground">{language}</div>
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-background p-3 font-mono text-xs [overflow-wrap:anywhere]">
          {code}
        </pre>
      </div>
    )
  }

  return (
    <Suspense
      fallback={
        <div
          aria-label={uiText("loading_mermaid_diagram_b8e5834f")}
          className="my-4 min-h-24 animate-pulse rounded-xl border bg-sidebar"
          data-mermaid-state="loading"
          role="status"
        />
      }
    >
      <LazyStreamdownMermaid code={code} />
    </Suspense>
  )
}

const STREAMDOWN_PLUGINS: PluginConfig = {
  cjk,
  code: lazyCodePlugin,
  renderers: [{ component: DeferredMermaidRenderer, language: "mermaid" }],
}

// Raw HTML deliberately stays out of the pipeline. The sanitizer and hardener
// remain for generated HAST, while the fail-closed transform owns every URL.
const SAFE_REHYPE_PLUGINS = [rehypeSanitize, defaultRehypePlugins.harden]
const SAFE_REMARK_PLUGINS = [...Object.values(defaultRemarkPlugins), remarkLocalRasterImages]
const LINK_SAFETY = {
  enabled: true,
  renderModal: (props: Parameters<typeof ExternalLinkDialog>[0]) => <ExternalLinkDialog {...props} />,
} as const
const REMEND_OPTIONS = { katex: false, linkMode: "text-only" as const }

export function StreamdownMarkdown({
  children,
  className,
  isStreaming,
  onPreviewImage,
}: {
  children: string
  className?: string
  isStreaming: boolean
  onPreviewImage?: (src: string) => void
}) {
  useUiLocale()
  const hostRef = useRef<HTMLDivElement>(null)
  const components = useMemo(() => ({
    span: StreamingRevealSpan,
    img: ({ node: _node, ...props }: React.ComponentProps<"img"> & { node?: unknown }) => (
      <InlineImage {...props} onPreviewImage={onPreviewImage} />
    ),
  }), [onPreviewImage])
  useCompactCodeBlocks(hostRef)

  return (
    <div ref={hostRef} style={{ display: "contents" }}>
      <StreamingReveal isStreaming={isStreaming}>
        <Streamdown
          animated={false}
          BlockComponent={StreamingRevealBlock}
          className={cn(
            "assistant-streamdown prose max-w-none min-w-0 space-y-0 font-normal text-foreground",
            "[overflow-wrap:anywhere] prose-p:my-2 prose-headings:mt-4 prose-headings:mb-2",
            "prose-a:text-primary prose-li:my-0.5",
            isStreaming && "assistant-streamdown-streaming",
            className,
          )}
          codeBlockMaxHeight={Number.POSITIVE_INFINITY}
          controls={false}
          components={components}
          dir="auto"
          isAnimating={isStreaming}
          lineNumbers={false}
          linkSafety={LINK_SAFETY}
          mode={isStreaming ? "streaming" : "static"}
          parseIncompleteMarkdown={isStreaming}
          plugins={STREAMDOWN_PLUGINS}
          rehypePlugins={SAFE_REHYPE_PLUGINS}
          remarkPlugins={SAFE_REMARK_PLUGINS}
          remend={REMEND_OPTIONS}
          shikiTheme={STREAMDOWN_THEMES}
          tableMaxHeight={Number.POSITIVE_INFINITY}
          urlTransform={safeAssistantUrlTransform}
        >
          {children}
        </Streamdown>
      </StreamingReveal>
    </div>
  )
}
