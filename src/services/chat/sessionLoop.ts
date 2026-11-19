const LOOP_COMMAND = /^\/loop(?:\s|$)/i
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

/** Preserve prompt text after the interval and reserve malformed /loop commands. */
export function parseSessionLoopCommand(text: string): SessionLoopCommand | "invalid" | null {
  const trimmed = text.trim()
  if (!isSessionLoopCommand(trimmed)) return null
  const args = trimmed.slice("/loop".length).trimStart()
  const action = args.toLowerCase()
  if (action === "status" || action === "stop" || action === "resume") return { action }

  const start = /^([0-9]+)([smhd])\s+([\s\S]+)$/.exec(args)
  if (!start) return "invalid"
  const interval = Number(start[1]) * INTERVAL_SECONDS[start[2] as keyof typeof INTERVAL_SECONDS]
  if (!Number.isSafeInteger(interval) || interval < 60 || interval > 86_400) return "invalid"
  return { action: "start", interval_seconds: interval, prompt: start[3] }
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
