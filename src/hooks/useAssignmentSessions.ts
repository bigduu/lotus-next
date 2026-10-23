import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { BoardAssignment } from "@services/tickets/projectBoard"
import { assignmentSessionKey, readAssignmentSessionAccess, type AssignmentSessionAccess, type AssignmentSessionTarget } from "@services/tickets/assignmentSessions"

type SessionRead = { status: "unknown" } | { status: "available"; value: AssignmentSessionAccess[]; updatedAt: null }
export function useAssignmentSessions(assignments: readonly BoardAssignment[] | undefined, workId: string, projectId: string, enabled: boolean) {
  const [online, setOnline] = useState(() => navigator.onLine)
  const [read, setRead] = useState<SessionRead>({ status: "unknown" })
  const epoch = useRef(0)
  const active = useRef<AbortController | null>(null)
  const versions = useRef(new Map<string, number>())
  const targets = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of assignments ?? []) counts.set(item.id, (counts.get(item.id) ?? 0) + 1)
    return (assignments ?? []).filter((item) => counts.get(item.id) === 1 && item.work_id === workId
      && Number.isSafeInteger(item.generation) && item.generation! >= 1
      && Number.isSafeInteger(item.authority_epoch) && item.authority_epoch! >= 1
      && item.runtime?.session_id && item.runtime.run_id)
      .map((item): AssignmentSessionTarget => ({ assignment_id: item.id, session_id: item.runtime!.session_id, run_id: item.runtime!.run_id }))
  }, [assignments, workId])
  useEffect(() => {
    const changed = () => { if (!navigator.onLine) active.current?.abort(); setOnline(navigator.onLine) }
    window.addEventListener("online", changed); window.addEventListener("offline", changed)
    return () => { window.removeEventListener("online", changed); window.removeEventListener("offline", changed) }
  }, [])
  const check = useCallback(async (target: AssignmentSessionTarget, controller: AbortController, expectedEpoch: number) => {
    const key = assignmentSessionKey(target)
    const version = (versions.current.get(key) ?? 0) + 1
    versions.current.set(key, version)
    try {
      const result = await readAssignmentSessionAccess(target, projectId, controller.signal)
      if (controller.signal.aborted || epoch.current !== expectedEpoch || versions.current.get(key) !== version) return
      setRead((previous) => ({ status: "available", updatedAt: null,
        value: [...(previous.status === "available" ? previous.value.filter((item) => assignmentSessionKey(item) !== key) : []), result] }))
      return result
    } catch { /* An aborted or superseded read cannot enable navigation. */ }
  }, [projectId])
  useEffect(() => {
    const controller = new AbortController()
    const expectedEpoch = ++epoch.current
    active.current = controller
    versions.current.clear()
    setRead({ status: "unknown" })
    if (enabled && online && assignments) {
      let next = 0
      if (!targets.length) setRead({ status: "available", value: [], updatedAt: null })
      for (let worker = 0; worker < Math.min(4, targets.length); worker++) void (async () => {
        while (!controller.signal.aborted && next < targets.length) await check(targets[next++], controller, expectedEpoch)
      })()
    }
    return () => { controller.abort(); epoch.current += 1 }
  }, [assignments, targets, enabled, online, check])
  const recheck = async (sessionId: string) => {
    const controller = active.current
    const target = targets.find((item) => item.session_id === sessionId)
    if (!enabled || !online || !target || !controller || controller.signal.aborted) return false
    const result = await check(target, controller, epoch.current)
    return result?.access === "accessible"
  }
  return { online, sessions: enabled && online ? read : { status: "unknown" as const }, recheck }
}
