import { uiText } from "@shared/i18n/text"
import type { Message } from "@shared/types/chatMessages"
import { buildMarkdown } from "@/lib/exportMarkdown"

function createExportOverlay() {
  const overlay = document.createElement("div")
  overlay.dataset.pdfExportOverlay = ""
  Object.assign(overlay.style, {
    position: "fixed", inset: "0", zIndex: "2147483647", background: "rgba(0,0,0,0.35)",
    display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px",
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  })
  const card = document.createElement("div")
  card.setAttribute("role", "status")
  Object.assign(card.style, {
    color: "#111", background: "#fff", border: "1px solid rgba(0,0,0,0.12)", borderRadius: "10px",
    padding: "12px 16px", maxWidth: "80vw", boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
  })
  card.textContent = uiText("exporting_pdf_9bdbbc51")
  overlay.append(card)
  document.body.append(overlay)

  const remove = () => overlay.remove()
  return {
    remove,
    fail(message: string) {
      card.setAttribute("role", "alert")
      card.textContent = message
      card.style.color = "#dc2626"
      overlay.style.cursor = "pointer"
      overlay.addEventListener("click", remove, { once: true })
      window.setTimeout(remove, 6000)
    },
  }
}

let active: Promise<void> | undefined

/** The expensive renderer is needed only by an explicit user download. */
export async function downloadPdf(messages: readonly Message[], title: string): Promise<void> {
  if (typeof document === "undefined") return
  if (active) return active
  const overlay = createExportOverlay()
  const name = title || "chat"
  active = import("./renderPdf").then(({ renderConversationPdf }) =>
    renderConversationPdf(buildMarkdown(messages, name), name),
  ).then(overlay.remove, (error: unknown) => {
    overlay.fail(uiText("could_not_export_pdf_0c1eb07c", { v0: error instanceof Error ? error.message : String(error) }))
  }).finally(() => { active = undefined })
  return active
}
