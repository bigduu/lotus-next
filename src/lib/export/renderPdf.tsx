import { createRoot } from "react-dom/client"
import { flushSync } from "react-dom"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeSanitize from "rehype-sanitize"
import html2canvas from "html2canvas"
import { jsPDF } from "jspdf"

import StaticMermaid, {
  MERMAID_LOADING_SELECTOR,
  initMermaidForExport,
  restoreMermaidAppConfig,
} from "./StaticMermaid"
import { addLandscapeDiagram, addPortraitRange, collectWideDiagrams } from "./pdfPaginator"

// Rendered-HTML → canvas → paginated-PDF pipeline (ported from lotus's
// MessageExportService): the conversation markdown is rendered offscreen with
// ReactMarkdown (mermaid blocks as pre-rasterized PNGs), captured with
// html2canvas — so CJK text comes out as pixels, sidestepping jspdf's missing
// CJK fonts — then sliced across A4 pages at whitespace rows.
//
// This module is heavy (react-markdown + mermaid + html2canvas + jspdf) and is
// only ever loaded via dynamic import from src/lib/exportPdf.ts.

// Deterministic light-on-white styling with explicit colors: the export must
// not depend on the app theme (Tailwind `dark:` variants would leak the app's
// dark mode onto the white PDF page). CJK-capable font stack for rasterization.
const EXPORT_FONT_FAMILY =
  "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, " +
  "'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif"

const EXPORT_CSS = `
  .pdf-export { color: #111; overflow-wrap: anywhere; }
  .pdf-export h1 { font-size: 24px; margin: 0 0 16px; }
  .pdf-export h2 { font-size: 18px; margin: 18px 0 10px; padding-bottom: 4px; border-bottom: 1px solid #eee; }
  .pdf-export h3 { font-size: 16px; margin: 14px 0 8px; }
  .pdf-export h4, .pdf-export h5, .pdf-export h6 { font-size: 14px; margin: 12px 0 6px; }
  .pdf-export p { margin: 6px 0; }
  .pdf-export ul, .pdf-export ol { margin: 6px 0; padding-left: 22px; }
  .pdf-export li { margin: 2px 0; }
  .pdf-export a { color: #0d9488; text-decoration: underline; }
  .pdf-export blockquote { margin: 8px 0; padding: 2px 12px; border-left: 3px solid #d9d9d9; color: #555; }
  .pdf-export hr { border: none; border-top: 1px solid #e5e5e5; margin: 14px 0; }
  .pdf-export code {
    background: #f0f0f0; border-radius: 4px; padding: 1px 5px; font-size: 0.85em;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
  }
  .pdf-export .pdf-pre { margin: 8px 0; }
  .pdf-export .pdf-pre code {
    display: block; border: 1px solid #d9d9d9; border-radius: 8px; background: #fafafa;
    padding: 10px 12px; white-space: pre-wrap; word-break: break-word; font-size: 12px;
  }
  .pdf-export table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 12px; }
  .pdf-export th, .pdf-export td {
    border: 1px solid #d9d9d9; padding: 6px 8px; text-align: left; vertical-align: top;
    word-break: break-word;
  }
  .pdf-export th { background: #f5f5f5; }
  .pdf-export img { max-width: 100%; }
`

// Same block-detection pattern as src/components/chat/Markdown.tsx, but with
// export-safe output: mermaid → StaticMermaid PNG, code → plain <pre>/<code>
// (no Prism theme, deterministic light colors).
const exportComponents: Components = {
  pre: ({ children }) => <div className="pdf-pre">{children}</div>,
  code(props) {
    const { children, className } = props
    const match = /language-(\w+)/.exec(className || "")
    if (!match) return <code>{children}</code>
    const value = String(children).replace(/\n$/, "")
    if (match[1] === "mermaid") return <StaticMermaid code={value} />
    return <code>{value}</code>
  },
}

async function waitForExportRenderReady(container: HTMLElement): Promise<void> {
  // Ensure layout + fonts settle before capture.
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  )
  await document.fonts.ready.catch(() => undefined)

  const start = Date.now()
  const timeoutMs = 6000
  while (Date.now() - start < timeoutMs) {
    const pendingMermaid = container.querySelector(MERMAID_LOADING_SELECTOR)
    if (!pendingMermaid) {
      // Give one more frame to flush post-render layout changes.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      return
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 50))
  }
}

async function awaitMermaidImagesDecoded(container: HTMLElement): Promise<void> {
  // collectWideDiagrams needs naturalWidth/Height; ensure the PNG <img>s that
  // StaticMermaid produced have actually decoded before we measure them.
  const imgs = Array.from(container.querySelectorAll<HTMLImageElement>("[data-mermaid-loading] img"))
  await Promise.all(
    imgs.map(async (img) => {
      if (img.complete && img.naturalWidth) return
      try {
        await img.decode()
      } catch {
        // Leave undecoded; collectWideDiagrams skips zero-size images.
      }
    }),
  )
}

async function renderCanvasWithFallback(container: HTMLElement): Promise<HTMLCanvasElement> {
  const baseOptions = {
    backgroundColor: "#ffffff",
    scale: 2,
    useCORS: true,
    allowTaint: true,
  }

  try {
    const canvas = await html2canvas(container, { ...baseOptions, foreignObjectRendering: true })
    if (canvas.width && canvas.height) return canvas
  } catch (error) {
    console.warn("PDF capture with foreignObjectRendering=true failed:", error)
  }

  const fallbackCanvas = await html2canvas(container, {
    ...baseOptions,
    foreignObjectRendering: false,
  })
  if (!fallbackCanvas.width || !fallbackCanvas.height) {
    throw new Error("PDF 渲染失败（画布为空）")
  }
  return fallbackCanvas
}

/**
 * Render the conversation markdown to an offscreen A4-width container, capture
 * it, paginate onto A4 pages (wide mermaid diagrams get their own landscape
 * page) and trigger a browser download of `${title}.pdf`.
 */
export async function renderConversationPdf(markdown: string, title: string): Promise<void> {
  if (typeof document === "undefined") throw new Error("PDF 导出仅在浏览器中可用")

  const container = document.createElement("div")
  container.style.position = "fixed"
  // NOTE: html2canvas can produce empty renders when the element is far
  // offscreen. Keep it at (0,0); the caller's progress overlay (one z-index
  // above) dims it so users don't notice.
  container.style.left = "0"
  container.style.top = "0"
  container.style.zIndex = "2147483646"
  container.style.pointerEvents = "none"
  // A4 width in px at 96dpi: 8.27in * 96 ≈ 794px
  container.style.width = "794px"
  container.style.background = "#fff"
  container.style.color = "#111"
  container.style.padding = "24px"
  container.style.boxSizing = "border-box"
  container.style.fontFamily = EXPORT_FONT_FAMILY
  container.style.fontSize = "14px"
  container.style.lineHeight = "1.5"

  const style = document.createElement("style")
  style.textContent = EXPORT_CSS
  container.appendChild(style)

  const rootHost = document.createElement("div")
  rootHost.className = "pdf-export"
  container.appendChild(rootHost)
  document.body.appendChild(container)

  // mermaid config is global: flip to a light theme for white pages, restore
  // the app's dark config (matching MermaidChart's ensureInit) afterwards.
  initMermaidForExport()
  const root = createRoot(rootHost)
  try {
    flushSync(() => {
      root.render(
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
          components={exportComponents}
        >
          {markdown}
        </ReactMarkdown>,
      )
    })

    await waitForExportRenderReady(container)
    await awaitMermaidImagesDecoded(container)
    const canvas = await renderCanvasWithFallback(container)

    const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" })
    const marginPt = 24

    // Portrait page geometry (page 1 is portrait at this point).
    const contentWidthPt = doc.internal.pageSize.getWidth() - marginPt * 2
    const contentHeightPt = doc.internal.pageSize.getHeight() - marginPt * 2
    const pxPerPt = canvas.width / contentWidthPt
    const portraitGeom = {
      marginPt,
      contentWidthPt,
      pxPerPt,
      sliceHeightPx: Math.max(1, Math.floor(contentHeightPt * pxPerPt)),
    }

    // jsPDF always opens with one portrait page; we add a page before drawing
    // each one (portrait or landscape) and delete the initial blank at the end.
    let pageCount = 0
    const addPortraitPage = () => {
      doc.addPage("a4", "portrait")
      pageCount += 1
    }
    const addLandscapePage = () => {
      doc.addPage("a4", "landscape")
      pageCount += 1
    }

    // Wide diagrams (aspect > 1.4 and too wide for the portrait column) get a
    // dedicated landscape page drawn from their own high-DPI PNG; everything
    // else flows down portrait pages around them, preserving document order.
    const wideDiagrams = collectWideDiagrams(container, canvas)

    let cursorPx = 0
    for (const diagram of wideDiagrams) {
      addPortraitRange(doc, canvas, cursorPx, diagram.topPx, addPortraitPage, portraitGeom)
      addLandscapeDiagram(doc, diagram, marginPt, addLandscapePage)
      cursorPx = diagram.bottomPx
    }
    addPortraitRange(doc, canvas, cursorPx, canvas.height, addPortraitPage, portraitGeom)

    if (pageCount > 0) doc.deletePage(1)

    doc.save(`${title}.pdf`)
  } finally {
    root.unmount()
    container.remove()
    restoreMermaidAppConfig()
  }
}
