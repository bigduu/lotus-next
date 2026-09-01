import { lazy, Suspense } from "react"

const StreamdownMarkdown = lazy(() =>
  import("./StreamdownMarkdown").then((module) => ({ default: module.StreamdownMarkdown })),
)

/** Keep the complete Streamdown/plugin graph out of the ordinary application boot. */
export function LazyAssistantMarkdown({
  children,
  isStreaming,
}: {
  children: string
  isStreaming: boolean
}) {
  return (
    <Suspense
      fallback={
        <div
          aria-busy={isStreaming || undefined}
          className="whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]"
          data-assistant-markdown-fallback="true"
        >
          {children}
        </div>
      }
    >
      <StreamdownMarkdown isStreaming={isStreaming}>{children}</StreamdownMarkdown>
    </Suspense>
  )
}
