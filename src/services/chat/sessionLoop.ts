const LOOP_COMMAND = /^\/loop(?:\s|$)/i
const FIXED_INTERVAL_SHAPE = /^[+-]?[0-9.][0-9.smhd]*[smhd]$/i
const INTERVAL_SECONDS = { s: 1, m: 60, h: 3_600, d: 86_400 } as const
const LOOP_STATES = ["scheduled", "paused", "stopped", "expired"] as const

export type SessionLoopCommand =
  | { action: "status" | "stop" | "resume" }
  | { action: "start"; interval_seconds: number; prompt: string }

export type SessionLoopState = (typeof LOOP_STATES)[number]

export interface SessionLoopStatus {
  session_id: string
  loop: { state: SessionLoopState; next_fire_at: string | null; last_run_status: string | null } | null
}

export function isSessionLoopCommand(text: string): boolean {
  return LOOP_COMMAND.test(text.trimStart())
}

/** Recognize explicit controls and reserve malformed fixed-interval syntax. */
export function parseSessionLoopCommand(text: string): SessionLoopCommand | "invalid" | "natural" | null {
  const trimmed = text.trim()
  if (!isSessionLoopCommand(trimmed)) return null
  const args = trimmed.slice("/loop".length).trimStart()
  if (!args) return "invalid"
  const firstSpace = args.search(/\s/)
  const token = firstSpace === -1 ? args : args.slice(0, firstSpace)
  const prompt = firstSpace === -1 ? "" : args.slice(firstSpace).trimStart()
  const action = token.toLowerCase()
  if (action === "status" || action === "stop" || action === "resume") {
    return prompt ? "invalid" : { action }
  }
  if (!FIXED_INTERVAL_SHAPE.test(token)) return "natural"

  const start = /^([0-9]+)([smhd])$/.exec(token)
  if (!start || !prompt) return "invalid"
  const interval = Number(start[1]) * INTERVAL_SECONDS[start[2] as keyof typeof INTERVAL_SECONDS]
  if (!Number.isSafeInteger(interval) || interval < 60 || interval > 86_400) return "invalid"
  return { action: "start", interval_seconds: interval, prompt }
}

export function readSessionLoopStatus(value: unknown, sessionId: string): SessionLoopStatus {
  const status = value as SessionLoopStatus | null
  if (status?.session_id === sessionId) {
    const loop = status.loop
    if (loop === null) return status
    if (loop && LOOP_STATES.includes(loop.state)
      && (loop.last_run_status === null || typeof loop.last_run_status === "string") && (
      loop.next_fire_at === null
      || (typeof loop.next_fire_at === "string" && Number.isFinite(Date.parse(loop.next_fire_at)))
    )) return status
  }
  throw new Error("Invalid session loop acknowledgement")
}
