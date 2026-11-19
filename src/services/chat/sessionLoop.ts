const LOOP_COMMAND = /^\/loop(?:\s|$)/i
const FIXED_INTERVAL_SHAPE = /^[+-]?[0-9.][0-9.smhd]*[smhd]$/i
const SPOKEN_INTERVAL = /\bevery\s+(?:[a-z]+(?:[- ][a-z]+)?\s+|[0-9]+\s+)?(?:seconds?|minutes?|hours?|days?)\b|每隔?\s*(?:[0-9]+|[一二两三四五六七八九十]+)?\s*个?\s*(?:秒钟?|分钟|小时|天)/i
const LEADING_INTERVAL = /^[0-9]+\s+(?:seconds?|minutes?|hours?|days?)\b/i
const SPOKEN_CONTROL = /^(?:(?:please |(?:can|could|would|will) you (?:please )?)?(?:stop|cancel|disable|end|resume|restart|re-enable) (?:this |the |my )?(?:recurring )?(?:loop|scheduled task)(?: please)?|(?:麻烦|请|帮我)?(?:停止|取消|结束|关闭|停掉|恢复|继续|重新开启)(?:一下|这个|当前的?|刚才的|我的)?(?:循环|定时任务)(?:吧)?)$/i
const SPOKEN_STATUS = /^(?:when (?:will|does) (?:this|the|my) loop (?:run next|next run)|这个循环下次什么时候运行)[。！!？?]?$/i
const TRAILING_CONTROL_PUNCTUATION = /[.。!！?？]+$/
const INTERVAL_SECONDS = { s: 1, m: 60, h: 3_600, d: 86_400 } as const
const LOOP_STATES = ["scheduled", "paused", "stopped", "expired"] as const

export type SessionLoopCommand =
  | { action: "status" | "stop" | "resume" }
  | { action: "start"; interval_seconds: number; prompt: string }
  | { action: "start_adaptive"; prompt: string }

export type SessionLoopState = (typeof LOOP_STATES)[number]
export type SessionLoopMode = "fixed" | "adaptive"

export interface SessionLoopStatus {
  session_id: string
  loop: {
    mode?: SessionLoopMode
    state: SessionLoopState
    next_fire_at: string | null
    last_run_status: string | null
  } | null
}

export function isSessionLoopCommand(text: string): boolean {
  return LOOP_COMMAND.test(text.trimStart())
}

/** Recognize loop management, intervals, and tasks with a model-chosen interval. */
export function parseSessionLoopCommand(text: string): SessionLoopCommand | "invalid" | "natural" | null {
  const trimmed = text.trim()
  if (!isSessionLoopCommand(trimmed)) return null
  const args = trimmed.slice("/loop".length).trimStart()
  if (!args) return "invalid"
  const firstSpace = args.search(/\s/)
  const token = firstSpace === -1 ? args : args.slice(0, firstSpace)
  const prompt = firstSpace === -1 ? "" : args.slice(firstSpace).trimStart()
  const action = token.replace(TRAILING_CONTROL_PUNCTUATION, "").toLowerCase()
  if (action === "status" || action === "stop" || action === "resume") {
    return prompt ? "invalid" : { action }
  }
  if (!FIXED_INTERVAL_SHAPE.test(token)) {
    const control = args.replace(TRAILING_CONTROL_PUNCTUATION, "").trimEnd()
    if (SPOKEN_INTERVAL.test(args) || LEADING_INTERVAL.test(args)
      || SPOKEN_CONTROL.test(control) || SPOKEN_STATUS.test(args)) return "natural"
    return { action: "start_adaptive", prompt: args }
  }

  const start = /^([0-9]+)([smhd])$/.exec(token)
  if (!start || !prompt) return "invalid"
  const interval = Number(start[1]) * INTERVAL_SECONDS[start[2] as keyof typeof INTERVAL_SECONDS]
  if (!Number.isSafeInteger(interval) || interval < 60 || interval > 86_400) return "invalid"
  return { action: "start", interval_seconds: interval, prompt }
}

export function readSessionLoopStatus(value: unknown, sessionId: string, command: SessionLoopCommand): SessionLoopStatus {
  const status = value as SessionLoopStatus | null
  if (status?.session_id === sessionId) {
    const loop = status.loop
    const adaptiveStart = command.action === "start_adaptive"
    if (loop === null && !adaptiveStart) return status
    if (loop && LOOP_STATES.includes(loop.state)
      && (loop.mode === undefined || loop.mode === "fixed" || loop.mode === "adaptive")
      && (!adaptiveStart || (loop.mode === "adaptive" && loop.state === "scheduled"))
      && (loop.last_run_status === null || typeof loop.last_run_status === "string") && (
      loop.next_fire_at === null
      || (typeof loop.next_fire_at === "string" && Number.isFinite(Date.parse(loop.next_fire_at)))
    )) return status
  }
  throw new Error("Invalid session loop acknowledgement")
}
