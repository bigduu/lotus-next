import { useEffect, useState } from "react"
import mermaid from "mermaid"

// Chrome-less mermaid renderer for the PDF export (ported from lotus's
// StaticMermaidChart): renders the diagram to SVG, then rasterizes it to a
// high-DPI PNG <img> so html2canvas embeds a crisp bitmap instead of
// re-rasterizing the SVG at capture scale. Exposes `data-mermaid-loading` so
// the export pipeline can wait for render completion and find the images.

export const MERMAID_LOADING_SELECTOR = '[data-mermaid-loading="true"]'

// Mirror of src/components/chat/MermaidChart.tsx ensureInit(): TOP-LEVEL
// htmlLabels:false renders native SVG <text> (survives sanitize + image
// rasterization) — a known mermaid gotcha; per-diagram alone isn't enough.
// mermaid config is a global singleton, so the export flips only the theme
// (light diagrams on white pages) and must restore the app config afterwards.
const APP_MERMAID_CONFIG = {
  startOnLoad: false,
  theme: "dark",
  securityLevel: "strict",
  htmlLabels: false,
  flowchart: { htmlLabels: false },
} as const

export function initMermaidForExport(): void {
  mermaid.initialize({ ...APP_MERMAID_CONFIG, theme: "default" })
}

export function restoreMermaidAppConfig(): void {
  mermaid.initialize({ ...APP_MERMAID_CONFIG })
}

interface RasterResult {
  /** PNG data URL, rendered at `scale`x the diagram's intrinsic size. */
  url: string
  /** Intrinsic (CSS px) width — used for layout; the PNG itself is higher-res. */
  width: number
  height: number
}

/**
 * Read a mermaid SVG's intrinsic size from its viewBox (falling back to
 * width/height attributes) and return a self-contained, explicitly-sized markup
 * string suitable for loading into an <img>.
 */
function prepareSvg(svgMarkup: string): { width: number; height: number; markup: string } {
  const doc = new DOMParser().parseFromString(svgMarkup, "image/svg+xml")
  const svg = doc.querySelector("svg")
  if (!svg) return { width: 0, height: 0, markup: svgMarkup }

  let width = 0
  let height = 0

  const viewBox = svg.getAttribute("viewBox")
  if (viewBox) {
    const parts = viewBox.split(/[\s,]+/).map(Number)
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      width = parts[2]
      height = parts[3]
    }
  }

  if (!width) width = parseFloat(svg.getAttribute("width") || "") || 0
  if (!height) height = parseFloat(svg.getAttribute("height") || "") || 0

  if (width && height) {
    // mermaid sets style="max-width:Npx" + width="100%"; force the intrinsic
    // pixel size so the rasterized image is at full resolution, not clamped.
    svg.setAttribute("width", String(width))
    svg.setAttribute("height", String(height))
    svg.style.maxWidth = "none"
  }
  if (!svg.getAttribute("xmlns")) {
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg")
  }

  return { width, height, markup: new XMLSerializer().serializeToString(svg) }
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = src
  })
}

/** Rasterize a mermaid SVG to a high-DPI PNG data URL; null on any failure. */
async function rasterizeSvgToPng(svgMarkup: string, scale: number): Promise<RasterResult | null> {
  if (typeof document === "undefined" || !svgMarkup) return null

  const { width, height, markup } = prepareSvg(svgMarkup)
  if (!width || !height) return null

  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
  const image = await loadImage(dataUrl)
  if (!image) return null

  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))

  const ctx = canvas.getContext("2d")
  if (!ctx) return null

  // Flatten onto white — diagrams are exported onto white PDF pages.
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)

  try {
    return { url: canvas.toDataURL("image/png"), width, height }
  } catch {
    // Tainted canvas (shouldn't happen for inline SVG, but stay defensive).
    return null
  }
}

let seq = 0

type State =
  | { kind: "loading" }
  | { kind: "png"; url: string; width: number }
  | { kind: "svg"; markup: string }
  | { kind: "error"; message: string }

export default function StaticMermaid({ code, scale = 3 }: { code: string; scale?: number }) {
  const [state, setState] = useState<State>({ kind: "loading" })

  useEffect(() => {
    let cancelled = false
    setState({ kind: "loading" })
    const id = `pdf-mmd-${seq++}`
    mermaid
      .render(id, code)
      .then(async ({ svg }) => {
        const png = await rasterizeSvgToPng(svg, scale)
        if (cancelled) return
        // Rasterization failed but the SVG rendered — inline the (strict-mode
        // sanitized) SVG so html2canvas still captures it, just less crisply.
        setState(png ? { kind: "png", url: png.url, width: png.width } : { kind: "svg", markup: svg })
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ kind: "error", message: e instanceof Error ? e.message : String(e) })
      })
    return () => {
      cancelled = true
    }
  }, [code, scale])

  if (state.kind === "error") {
    return (
      <pre
        data-mermaid-loading="false"
        style={{
          border: "1px solid #d9d9d9",
          borderRadius: 8,
          padding: 12,
          background: "#fafafa",
          color: "#1f1f1f",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontSize: 12,
        }}
      >
        {`Mermaid 渲染失败: ${state.message}\n\n${code}`}
      </pre>
    )
  }

  if (state.kind === "png") {
    return (
      <div data-mermaid-loading="false" style={{ margin: "8px 0" }}>
        <img
          src={state.url}
          alt="Mermaid diagram"
          style={{ width: state.width, maxWidth: "100%", height: "auto", display: "block" }}
        />
      </div>
    )
  }

  if (state.kind === "svg") {
    return (
      <div
        data-mermaid-loading="false"
        style={{ margin: "8px 0" }}
        // mermaid securityLevel:"strict" already sanitizes its SVG output; the
        // interactive MermaidChart inlines it the same way.
        dangerouslySetInnerHTML={{ __html: state.markup }}
      />
    )
  }

  return <div data-mermaid-loading="true" style={{ minHeight: 24 }} />
}
