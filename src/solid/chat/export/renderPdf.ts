import { uiText } from "@shared/i18n/text"
import html2canvas from "html2canvas"
import { jsPDF } from "jspdf"
import { addLandscapeDiagram, addPortraitRange, collectWideDiagrams } from "@/lib/export/pdfPaginator"
import { renderPdfMarkdown } from "./pdfMarkdown"

const EXPORT_FONT_FAMILY =
  "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, " +
  "'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif"

const EXPORT_CSS = `
  .pdf-export { color: #111; overflow-wrap: anywhere; }
  .pdf-export h1 { font-size: 24px; margin: 0 0 16px; }
  .pdf-export h2 { font-size: 18px; margin: 18px 0 10px; padding-bottom: 4px; border-bottom: 1px solid #eee; }
  .pdf-export h3 { font-size: 16px; margin: 14px 0 8px; }
  .pdf-export h4, .pdf-export h5, .pdf-export h6 { font-size: 14px; margin: 12px 0 6px; }
  .pdf-export h1, .pdf-export h2, .pdf-export h3, .pdf-export h4, .pdf-export h5, .pdf-export h6 { font-weight: 600; }
  .pdf-export p { margin: 6px 0; }
  .pdf-export ul, .pdf-export ol { margin: 6px 0; padding-left: 22px; }
  .pdf-export ul { list-style-type: disc; }
  .pdf-export ol { list-style-type: decimal; }
  .pdf-export li { margin: 2px 0; }
  .pdf-export .task-list-item { list-style: none; }
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

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}

async function capture(container: HTMLElement) {
  const options = { backgroundColor: "#fff", scale: 2, useCORS: true, allowTaint: false, logging: false }
  try {
    const canvas = await html2canvas(container, { ...options, foreignObjectRendering: true })
    if (canvas.width && canvas.height) return canvas
  } catch { /* Foreign-object capture is not available on every browser. */ }

  const canvas = await html2canvas(container, { ...options, foreignObjectRendering: false })
  if (!canvas.width || !canvas.height) throw new Error(uiText("could_not_render_pdf_empty_canvas_bf3b7e39"))
  return canvas
}

function savePdf(container: HTMLElement, canvas: HTMLCanvasElement, title: string) {
  const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" })
  const marginPt = 24
  const contentWidthPt = pdf.internal.pageSize.getWidth() - marginPt * 2
  const contentHeightPt = pdf.internal.pageSize.getHeight() - marginPt * 2
  const pxPerPt = canvas.width / contentWidthPt
  const geometry = {
    marginPt, contentWidthPt, pxPerPt, sliceHeightPx: Math.max(1, Math.floor(contentHeightPt * pxPerPt)),
  }

  const landscapePage = () => { pdf.addPage("a4", "landscape") }
  const portraitPage = () => { pdf.addPage("a4", "portrait") }
  let cursor = 0
  for (const diagram of collectWideDiagrams(container, canvas)) {
    addPortraitRange(pdf, canvas, cursor, diagram.topPx, portraitPage, geometry)
    addLandscapeDiagram(pdf, diagram, marginPt, landscapePage)
    cursor = diagram.bottomPx
  }
  addPortraitRange(pdf, canvas, cursor, canvas.height, portraitPage, geometry)
  if (pdf.getNumberOfPages() > 1) pdf.deletePage(1)
  pdf.save(`${title}.pdf`)
}

/** Render HTML to pixels before PDF pagination so browser CJK fallback fonts are preserved. */
export async function renderConversationPdf(markdown: string, title: string): Promise<void> {
  if (typeof document === "undefined") throw new Error(uiText("pdf_export_is_only_available_in_a_browser_2c47a3d5"))
  const container = document.createElement("div")
  container.dataset.pdfExportDocument = ""
  container.setAttribute("aria-hidden", "true")
  container.inert = true
  // Capture at viewport origin, behind the progress overlay. html2canvas can
  // produce empty output if the element is moved far offscreen.
  Object.assign(container.style, {
    position: "fixed", left: "0", top: "0", zIndex: "2147483646", pointerEvents: "none",
    width: "794px", background: "#fff", color: "#111", padding: "24px", boxSizing: "border-box",
    fontFamily: EXPORT_FONT_FAMILY, fontSize: "14px", lineHeight: "1.5",
  })
  const style = document.createElement("style")
  style.textContent = EXPORT_CSS
  const host = document.createElement("div")
  host.className = "pdf-export"
  container.append(style, host)
  document.body.append(container)

  try {
    await renderPdfMarkdown(host, markdown)
    await nextFrame()
    await document.fonts.ready.catch(() => undefined)
    const diagrams = container.querySelectorAll<HTMLImageElement>("[data-mermaid-loading] img")
    await Promise.all([...diagrams].map((image) => image.decode().catch(() => undefined)))
    await nextFrame()
    savePdf(container, await capture(container), title)
  } finally {
    container.remove()
  }
}
