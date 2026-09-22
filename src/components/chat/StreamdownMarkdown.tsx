import { lazy, Suspense, useLayoutEffect, useRef, type RefObject } from "react"
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
  // Unspaced CJK prose is a single "word" to Streamdown, so word-level
  // splitting only animates when a new Markdown block starts.
  sep: "char",
  stagger: 16,
} as const

const ANIMATED_TOKEN_SELECTOR = 'span[data-sd-animate="true"]'

const COMPACT_CODE_BLOCK_STYLES = {
  block: { gap: "0.25rem", marginBlock: "0.5rem", padding: "0.375rem" },
  body: { fontSize: "0.875rem", lineHeight: "1.55", padding: "0.625rem 0.75rem" },
  header: { fontSize: "0.75rem", height: "1.25rem", lineHeight: "1rem" },
  source: {
    background: "transparent",
    fontSize: "inherit",
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
  content: string,
): void {
  useLayoutEffect(() => {
    const root = hostRef.current?.querySelector<HTMLElement>(".assistant-streamdown")
    if (!root) return

    applyCompactCodeBlockStyles(root)
    const observer = new MutationObserver(() => applyCompactCodeBlockStyles(root))
    observer.observe(root, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [content, hostRef])
}

function animationDurationMs(element: HTMLElement): number {
  return Number.parseFloat(element.style.getPropertyValue("--sd-duration")) || 0
}

type TypewriterCaretTracker = {
  positionAt: (target: HTMLElement | null) => void
  root: HTMLElement
}

/**
 * Streamdown's built-in caret is attached to the final Markdown block, while
 * every animated token already occupies its final layout position. That makes
 * the caret jump to the completed text before the staggered characters become
 * visible. Follow each token's animationstart event instead, keeping the caret
 * beside the character the user can currently see.
 */
function useTrackedTypewriterCaret(
  hostRef: RefObject<HTMLDivElement | null>,
  content: string,
  isStreaming: boolean,
): void {
  const trackerRef = useRef<TypewriterCaretTracker | null>(null)

  useLayoutEffect(() => {
    if (!isStreaming) return

    const root = hostRef.current?.querySelector<HTMLElement>(".assistant-streamdown")
    if (!root) return

    // Keep the visual caret outside React's text spans. Portaling or appending
    // into a span whose text children React owns causes reconciliation warnings.
    // A fixed, pointer-transparent overlay can follow the same glyph coordinates
    // without affecting wrapping or the Markdown DOM.
    const caret = document.createElement("span")
    caret.className = "animate-pulse"
    caret.dataset.assistantTypewriterCaret = "true"
    caret.setAttribute("aria-hidden", "true")
    Object.assign(caret.style, {
      borderRadius: "1px",
      display: "none",
      pointerEvents: "none",
      position: "fixed",
      zIndex: "30",
    })
    document.body.append(caret)

    let positionedTarget: HTMLElement | null = null
    const updateCaretPosition = () => {
      if (!positionedTarget?.isConnected) {
        caret.style.display = "none"
        return
      }
      const rect = positionedTarget.getBoundingClientRect()
      const computed = window.getComputedStyle(positionedTarget)
      const fontSize = Number.parseFloat(computed.fontSize) || rect.height
      const height = Math.min(rect.height, fontSize * 0.9)
      const width = Math.max(3, fontSize * 0.45)
      const gap = Math.max(1, fontSize * 0.08)
      const left = computed.direction === "rtl" ? rect.left - width - gap : rect.right + gap

      Object.assign(caret.style, {
        backgroundColor: computed.color,
        display: "block",
        height: `${height}px`,
        left: `${left}px`,
        top: `${rect.top + (rect.height - height) / 2}px`,
        width: `${width}px`,
      })
    }
    const positionAt = (target: HTMLElement | null) => {
      if (positionedTarget === target) return
      positionedTarget?.removeAttribute("data-assistant-typewriter-caret-target")
      positionedTarget = target
      target?.setAttribute("data-assistant-typewriter-caret-target", "true")
      updateCaretPosition()
    }

    const handleAnimationStart = (event: Event) => {
      const animationEvent = event as AnimationEvent
      const target = event.target
      if (!animationEvent.animationName.startsWith("sd-")) return
      if (!(target instanceof HTMLElement) || !target.matches(ANIMATED_TOKEN_SELECTOR)) return
      if (animationDurationMs(target) === 0) return
      positionAt(target)
    }

    trackerRef.current = { positionAt, root }
    root.addEventListener("animationstart", handleAnimationStart)
    window.addEventListener("resize", updateCaretPosition)
    window.addEventListener("scroll", updateCaretPosition, true)
    return () => {
      root.removeEventListener("animationstart", handleAnimationStart)
      window.removeEventListener("resize", updateCaretPosition)
      window.removeEventListener("scroll", updateCaretPosition, true)
      positionedTarget?.removeAttribute("data-assistant-typewriter-caret-target")
      caret.remove()
      trackerRef.current = null
    }
  }, [hostRef, isStreaming])

  useLayoutEffect(() => {
    if (!isStreaming) return
    const tracker = trackerRef.current
    if (!tracker) return

    const tokens = [
      ...tracker.root.querySelectorAll<HTMLElement>(ANIMATED_TOKEN_SELECTOR),
    ]
    const prefersReducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches

    if (prefersReducedMotion) {
      tracker.positionAt(tokens.at(-1) ?? null)
      return
    }

    const settledTokens = tokens.filter((token) => animationDurationMs(token) === 0)
    const animatingTokens = tokens.filter((token) => animationDurationMs(token) > 0)
    // During a streaming update, remain at the last settled character until
    // the first new character's animation actually begins.
    tracker.positionAt(settledTokens.at(-1) ?? animatingTokens.at(0) ?? null)
  }, [content, isStreaming])
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
  const hostRef = useRef<HTMLDivElement>(null)
  useCompactCodeBlocks(hostRef, children)
  useTrackedTypewriterCaret(hostRef, children, isStreaming)

  return (
    <div ref={hostRef} style={{ display: "contents" }}>
      <Streamdown
        animated={isStreaming ? STREAMDOWN_ANIMATION : false}
        className={cn(
          "assistant-streamdown prose max-w-none min-w-0 space-y-0 font-normal text-foreground dark:prose-invert",
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
    </div>
  )
}
