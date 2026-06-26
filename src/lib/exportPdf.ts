import type { Message } from "@shared/types/chatMessages"
import { buildMarkdown } from "./exportMarkdown"

/**
 * Lazy text-based PDF export. jspdf is heavy, so it's dynamically imported only
 * when the user actually exports. Renders the conversation as wrapped plain text
 * (markdown source) — good enough for an archive; rich layout is a later pass.
 */
export async function downloadPdf(messages: Message[], title: string) {
  const { jsPDF } = await import("jspdf")
  const doc = new jsPDF({ unit: "pt", format: "a4" })
  const margin = 40
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const maxWidth = pageWidth - margin * 2

  doc.setFontSize(11)
  const text = buildMarkdown(messages, title || "chat")
  const lines = doc.splitTextToSize(text, maxWidth) as string[]

  let y = margin
  const lineHeight = 15
  for (const line of lines) {
    if (y > pageHeight - margin) {
      doc.addPage()
      y = margin
    }
    doc.text(line, margin, y)
    y += lineHeight
  }

  doc.save(`${title || "chat"}.pdf`)
}
