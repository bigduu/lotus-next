import { lazy, Suspense } from "react"

const Markdown = lazy(() => import("./Markdown").then((m) => ({ default: m.Markdown })))

/**
 * Defers react-markdown (and its plugins) out of first paint. Until the chunk
 * loads, the raw text is shown as a plain paragraph — graceful, no layout jump.
 */
export function LazyMarkdown({ children }: { children: string }) {
  return (
    <Suspense
      fallback={<div className="whitespace-pre-wrap text-sm leading-relaxed">{children}</div>}
    >
      <Markdown>{children}</Markdown>
    </Suspense>
  )
}
