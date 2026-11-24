import { isGoalResumeCommand } from "@services/chat/goalCommand"
import { parseSessionLoopCommand, type SessionLoopCommand } from "@services/chat/sessionLoop"

export type ComposerCommand =
  | { kind: "compact" | "workflow" }
  | { kind: "loop"; action: SessionLoopCommand | "invalid" | "natural" }
  | { kind: "goal"; action: "open" | "configure" | "resume"; message: string }

export function parseComposerCommand(content: string): ComposerCommand | null {
  const message = content.trim()
  const lower = message.toLowerCase()
  if (lower === "/compact") return { kind: "compact" }
  if (lower === "/workflow") return { kind: "workflow" }
  const loop = parseSessionLoopCommand(message)
  if (loop !== null) return { kind: "loop", action: loop }
  if (isGoalResumeCommand(message)) return { kind: "goal", action: "resume", message }
  const goal = /^\/goal(?:\s+([\s\S]*))?$/i.exec(message)
  if (goal) return { kind: "goal", action: goal[1]?.trim() ? "configure" : "open", message }
  return null
}
