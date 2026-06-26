import { lazy, memo, Suspense } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeSanitize from "rehype-sanitize"

import { cn } from "@/lib/utils"

// Heavy deps — loaded only when the relevant block renders.
const CodeBlock = lazy(() => import("./CodeBlock"))
const MermaidChart = lazy(() => import("./MermaidChart"))

const components: Components = {
  pre: ({ children }) => (
    // A bare <code> child = a no-language fenced block: force it to a wrapping
    // block (paths/URLs) so it never needs a scrollbar that clips content.
    // With-language blocks render <CodeBlock> (a div), unaffected by [&>code].
    <div className="my-2 overflow-hidden rounded-lg border text-xs [&>code]:block [&>code]:whitespace-pre-wrap [&>code]:break-words [&>code]:rounded-none [&>code]:bg-transparent [&>code]:p-3 [&>code]:[overflow-wrap:anywhere]">
      {children}
    </div>
  ),
  code(props) {
    const { children, className } = props
    const match = /language-(\w+)/.exec(className || "")
    const value = String(children).replace(/\n$/, "")
    if (match) {
      if (match[1] === "mermaid") {
        return (
          <Suspense fallback={<pre className="overflow-x-auto p-3 font-mono text-xs">{value}</pre>}>
            <MermaidChart code={value} />
          </Suspense>
        )
      }
      return (
        <Suspense
          fallback={<pre className="overflow-x-auto p-3 font-mono text-xs">{value}</pre>}
        >
          <CodeBlock language={match[1]} value={value} />
        </Suspense>
      )
    }
    return (
      <code className="rounded bg-background/70 px-1 py-0.5 text-[0.85em] [overflow-wrap:anywhere]">
        {children}
      </code>
    )
  },
}

/**
 * Tailwind-typography rendered markdown for assistant messages. GFM tables/
 * task-lists, sanitized HTML, and (lazy) Prism-highlighted fenced code blocks.
 */
function MarkdownImpl({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={cn(
        "prose prose-sm dark:prose-invert max-w-none [overflow-wrap:anywhere]",
        "prose-p:my-2 prose-headings:mt-3 prose-headings:mb-1.5",
        "prose-pre:my-0 prose-pre:bg-transparent prose-pre:p-0",
        "prose-a:text-primary prose-li:my-0.5",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}

export const Markdown = memo(MarkdownImpl)
