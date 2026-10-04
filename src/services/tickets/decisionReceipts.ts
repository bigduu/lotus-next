import type { ResponseCommand } from "./types"

const prefix = (session: string) => `lotus-next.ticket-decision.${encodeURIComponent(session)}.`
const key = (session: string, request: string) => prefix(session) + encodeURIComponent(request)

// Store the exact bounded command before delivery so navigation or reload
// cannot turn an unknown approval into a new, possibly opposite decision.
export function readDecisionReceipts(session: string): Record<string, ResponseCommand> {
  const result: Record<string, ResponseCommand> = {}
  for (const name of Object.keys(sessionStorage).filter((name) => name.startsWith(prefix(session)))) {
    const raw = sessionStorage.getItem(name)
    if (!raw || raw.length > 32768) throw new Error("请求回执无法核对，回答和批准已暂停。")
    const command = JSON.parse(raw) as ResponseCommand
    const identity = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 512
    const revision = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 1
    if (!command || typeof command !== "object" || Array.isArray(command)
      || !identity(command.operation_id) || command.binding?.supervisor_session_id !== session
      || !identity(command.binding?.scope_id) || !revision(command.binding?.binding_revision)
      || !identity(command.target?.request_id) || name !== key(session, command.target.request_id)
      || !identity(command.target?.work_id)
      || !(command.target?.assignment_id === null || identity(command.target?.assignment_id))
      || !revision(command.target?.generation) || !revision(command.target?.contract_revision) || !revision(command.target?.prompt_revision)
      || !Number.isSafeInteger(command.expected_seq) || command.expected_seq < 0 || !revision(command.expected_epoch)
      || !(command.decision?.kind === "question" && typeof command.decision.answer === "string" && command.decision.answer.trim().length > 0
        || command.decision?.kind === "approval" && identity(command.decision.fingerprint) && typeof command.decision.approve === "boolean")) {
      throw new Error("请求回执无法核对，回答和批准已暂停。")
    }
    result[command.target.request_id] = command
  }
  return result
}

export function saveDecisionReceipt(session: string, command: ResponseCommand) {
  const raw = JSON.stringify(command)
  if (raw.length > 32768) throw new Error("请求回执超出保存限制，尚未发送。")
  sessionStorage.setItem(key(session, command.target.request_id), raw)
  if (sessionStorage.getItem(key(session, command.target.request_id)) !== raw) throw new Error("请求回执未保存，尚未发送。")
}

export function clearDecisionReceipt(session: string, command: ResponseCommand) {
  const name = key(session, command.target.request_id)
  if (sessionStorage.getItem(name) === JSON.stringify(command)) sessionStorage.removeItem(name)
}
