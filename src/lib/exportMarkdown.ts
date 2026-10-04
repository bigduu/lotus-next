import { uiText } from "@shared/i18n/ui"
import type { Message } from "@shared/types/chatMessages"

function roleLabel(role: string): string {
  if (role === "user") return uiText("user_0d0e1a86")
  if (role === "assistant") return uiText("assistant_e5ce5f6d")
  if (role === "system") return uiText("system_5b50d7c4")
  return role
}

function content(m: Message): string {
  if ("content" in m && typeof (m as { content?: unknown }).content === "string") {
    return (m as { content: string }).content
  }
  return ""
}

export function buildMarkdown(messages: Message[], title: string): string {
  const lines: string[] = [`# ${title}`, ""]
  for (const m of messages) {
    const text = content(m)
    if (!text) continue
    lines.push(`## ${roleLabel(m.role)}`, "", text, "")
  }
  return lines.join("\n")
}

export function downloadMarkdown(messages: Message[], title: string) {
  const md = buildMarkdown(messages, title || "chat")
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `${title || "chat"}.md`
  a.click()
  URL.revokeObjectURL(url)
}
