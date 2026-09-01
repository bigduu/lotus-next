import { useEffect, useState } from "react"
import { createMermaidPlugin } from "@streamdown/mermaid"

import { getTrustedMermaidConfig } from "@/lib/mermaid/strictConfig"

const trustedAppConfig = getTrustedMermaidConfig("app")
const mermaidPlugin = createMermaidPlugin({ config: trustedAppConfig })

type MermaidState =
  | { kind: "loading" }
  | { kind: "ready"; source: string; svg: string }
  | { kind: "error"; message: string; source: string }

let sequence = 0

/** Completed-fence-only Mermaid renderer backed by #14's frozen strict policy. */
export default function StreamdownMermaid({ code }: { code: string }) {
  const [state, setState] = useState<MermaidState>({ kind: "loading" })

  useEffect(() => {
    let cancelled = false
    setState({ kind: "loading" })

    // Passing the trusted config on every render restores the app policy after
    // a PDF export temporarily switches Mermaid's process-global theme.
    const mermaid = mermaidPlugin.getMermaid(trustedAppConfig)
    const id = `streamdown-mermaid-${sequence++}`
    void mermaid
      .render(id, code)
      .then(({ svg }) => {
        if (!cancelled) setState({ kind: "ready", source: code, svg })
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            kind: "error",
            message: error instanceof Error ? error.message : String(error),
            source: code,
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [code])

  if (state.kind === "loading" || state.source !== code) {
    return (
      <div
        aria-label="正在渲染 Mermaid 图表"
        className="my-4 min-h-24 animate-pulse rounded-xl border bg-sidebar"
        data-mermaid-state="loading"
        role="status"
      />
    )
  }

  if (state.kind === "error") {
    return (
      <figure
        aria-label="Mermaid 图表无法渲染"
        aria-live="polite"
        className="my-4 min-w-0 rounded-xl border border-destructive/40 bg-destructive/5 p-3"
        data-mermaid-state="error"
        role="alert"
      >
        <figcaption className="mb-2 text-xs font-medium text-destructive">
          Mermaid 图表无法渲染
        </figcaption>
        <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">
          {code}
        </pre>
        <span className="sr-only">{state.message}</span>
      </figure>
    )
  }

  return (
    <div
      aria-label="Mermaid 图表"
      className="my-4 flex min-w-0 justify-center overflow-x-auto rounded-xl border bg-background p-2 [&_svg]:h-auto [&_svg]:max-w-full"
      data-mermaid-state="ready"
      // Mermaid's SVG was produced under #14's securityLevel:"strict",
      // htmlLabels:false contract; never accept model-provided configuration.
      dangerouslySetInnerHTML={{ __html: state.svg }}
      role="img"
    />
  )
}
