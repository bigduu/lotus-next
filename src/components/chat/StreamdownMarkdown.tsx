import { lazy, Suspense } from "react"
import { cjk } from "@streamdown/cjk"
import rehypeSanitize from "rehype-sanitize"
import {
  defaultRehypePlugins,
  Streamdown,
  type CustomRendererProps,
  type PluginConfig,
} from "streamdown"
import "streamdown/styles.css"

import { cn } from "@/lib/utils"
import {
  lazyCodePlugin,
  safeAssistantUrlTransform,
  STREAMDOWN_THEMES,
} from "./streamdownConfig"

const STREAMDOWN_ANIMATION = {
  animation: "fadeIn",
  duration: 120,
  maxBacklogMs: 240,
  sep: "word",
  stagger: 24,
} as const

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
  if (isIncomplete) {
    return (
      <div
        aria-label="Mermaid 图表仍在接收内容"
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
          aria-label="正在加载 Mermaid 图表"
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
const LINK_SAFETY = { enabled: true } as const
const REMEND_OPTIONS = { katex: false, linkMode: "text-only" as const }

export function StreamdownMarkdown({
  children,
  className,
  isStreaming,
}: {
  children: string
  className?: string
  isStreaming: boolean
}) {
  return (
    <Streamdown
      animated={isStreaming ? STREAMDOWN_ANIMATION : false}
      caret={isStreaming ? "block" : undefined}
      className={cn(
        "assistant-streamdown prose prose-sm dark:prose-invert max-w-none min-w-0 space-y-0",
        "[overflow-wrap:anywhere] prose-p:my-2 prose-headings:mt-3 prose-headings:mb-1.5",
        "prose-a:text-primary prose-li:my-0.5",
        className,
      )}
      codeBlockMaxHeight={Number.POSITIVE_INFINITY}
      controls={false}
      dir="auto"
      isAnimating={isStreaming}
      lineNumbers={false}
      linkSafety={LINK_SAFETY}
      mode={isStreaming ? "streaming" : "static"}
      parseIncompleteMarkdown={isStreaming}
      plugins={STREAMDOWN_PLUGINS}
      rehypePlugins={SAFE_REHYPE_PLUGINS}
      remend={REMEND_OPTIONS}
      shikiTheme={STREAMDOWN_THEMES}
      tableMaxHeight={Number.POSITIVE_INFINITY}
      urlTransform={safeAssistantUrlTransform}
    >
      {children}
    </Streamdown>
  )
}
