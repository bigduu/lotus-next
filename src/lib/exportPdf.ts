import type { Message } from "@shared/types/chatMessages"
import { buildMarkdown } from "./exportMarkdown"

// PDF export = rendered-HTML → html2canvas → paginated jsPDF (ported from
// lotus). The old jspdf text dump garbled CJK (no CJK font) and lost all
// formatting; rasterizing the rendered markdown sidesteps both. The heavy
// pipeline (react-markdown + mermaid + html2canvas + jspdf) lives in
// ./export/renderPdf and is only loaded when the user actually exports.

/** Progress overlay + inline error banner (callers fire-and-forget this export). */
function createExportOverlay() {
  const overlay = document.createElement("div")
  overlay.style.position = "fixed"
  overlay.style.inset = "0"
  // One above the offscreen render container (2147483646) so it stays hidden.
  overlay.style.zIndex = "2147483647"
  overlay.style.background = "rgba(0,0,0,0.35)"
  overlay.style.display = "flex"
  overlay.style.alignItems = "center"
  overlay.style.justifyContent = "center"
  overlay.style.fontFamily =
    "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
  overlay.style.fontSize = "14px"

  const card = document.createElement("div")
  card.style.background = "#fff"
  card.style.color = "#111"
  card.style.border = "1px solid rgba(0,0,0,0.12)"
  card.style.borderRadius = "10px"
  card.style.padding = "12px 16px"
  card.style.maxWidth = "80vw"
  card.style.boxShadow = "0 8px 24px rgba(0,0,0,0.12)"
  card.textContent = "正在导出 PDF…"
  overlay.appendChild(card)
  document.body.appendChild(overlay)

  let removed = false
  const remove = () => {
    if (removed) return
    removed = true
    overlay.remove()
  }

  return {
    remove,
    /** Surface a failure inline (red banner, click or 6s to dismiss). */
    fail(message: string) {
      card.textContent = message
      card.style.color = "#dc2626"
      overlay.style.cursor = "pointer"
      overlay.addEventListener("click", remove)
      window.setTimeout(remove, 6000)
    },
  }
}

/**
 * Export the conversation as a paginated A4 PDF of the rendered markdown
 * (CJK-safe, mermaid diagrams included). Failures are surfaced in an inline
 * banner here because callers invoke this fire-and-forget.
 */
export async function downloadPdf(messages: Message[], title: string) {
  if (typeof document === "undefined") return
  const overlay = createExportOverlay()
  try {
    const { renderConversationPdf } = await import("./export/renderPdf")
    await renderConversationPdf(buildMarkdown(messages, title || "chat"), title || "chat")
    overlay.remove()
  } catch (error) {
    console.error("PDF export failed:", error)
    overlay.fail(`导出 PDF 失败：${error instanceof Error ? error.message : String(error)}`)
  }
}
