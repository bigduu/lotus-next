import { useEffect, useRef, useState } from "react"
import mermaid from "mermaid"

let initialized = false
function ensureInit() {
  if (initialized) return
  // TOP-LEVEL htmlLabels:false renders native SVG <text> (survives sanitize +
  // image rasterization) — a known mermaid gotcha; per-diagram alone isn't enough.
  mermaid.initialize({
    startOnLoad: false,
    theme: "dark",
    securityLevel: "strict",
    htmlLabels: false,
    flowchart: { htmlLabels: false },
  })
  initialized = true
}

let seq = 0

/**
 * Lazy-loaded mermaid diagram renderer for ```mermaid fenced blocks. Falls back
 * to the raw source on a parse error. mermaid itself is a heavy dep, so this
 * module is only imported when a mermaid block actually appears.
 */
export default function MermaidChart({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ensureInit()
    const id = `mmd-${seq++}`
    mermaid
      .render(id, code)
      .then(({ svg }) => {
        if (!cancelled && ref.current) ref.current.innerHTML = svg
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [code])

  if (error) {
    return (
      <pre className="overflow-x-auto p-3 font-mono text-xs text-muted-foreground">{code}</pre>
    )
  }
  return <div ref={ref} className="flex justify-center overflow-x-auto py-2 [&_svg]:max-w-full" />
}
