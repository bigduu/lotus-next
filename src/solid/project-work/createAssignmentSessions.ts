import { createEffect, createMemo, createSignal, onSettled, type Accessor } from "solid-js"

import type { BoardAssignment } from "@services/tickets/projectBoard"
import { assignmentSessionKey, readAssignmentSessionAccess, type AssignmentSessionAccess, type AssignmentSessionTarget } from "@services/tickets/assignmentSessions"

type SessionRead = { status: "unknown" } | { status: "available"; value: AssignmentSessionAccess[]; updatedAt: null }

export function createAssignmentSessions(
  assignments: Accessor<readonly BoardAssignment[] | undefined>, workId: Accessor<string>,
  projectId: Accessor<string>, enabled: Accessor<boolean>,
) {
  const [online, setOnline] = createSignal(navigator.onLine)
  const [read, setRead] = createSignal<SessionRead>({ status: "unknown" })
  const targets = createMemo(() => {
    const counts = new Map<string, number>()
    const items = assignments() ?? []
    const id = workId()
    for (const item of items) counts.set(item.id, (counts.get(item.id) ?? 0) + 1)
    return items.flatMap((item): AssignmentSessionTarget[] =>
      counts.get(item.id) === 1 && item.work_id === id && (item.generation ?? 0) >= 1 && Number.isSafeInteger(item.generation)
      && (item.authority_epoch ?? 0) >= 1 && Number.isSafeInteger(item.authority_epoch)
      && item.runtime?.session_id && item.runtime.run_id
        ? [{ assignment_id: item.id, session_id: item.runtime.session_id, run_id: item.runtime.run_id }] : [],
    )
  })
  const scope = createMemo(() => ({
    projectId: projectId(), targets: targets(), loaded: assignments() !== undefined, enabled: enabled() && online(),
  }))
  type Check = { scope: ReturnType<typeof scope>; controller: AbortController; versions: Map<string, number> }
  let active: Check | undefined

  onSettled(() => {
    const changed = () => {
      if (!navigator.onLine) active?.controller.abort()
      setOnline(navigator.onLine)
    }
    window.addEventListener("online", changed)
    window.addEventListener("offline", changed)
    return () => {
      window.removeEventListener("online", changed)
      window.removeEventListener("offline", changed)
    }
  })
  const current = (check: Check) => active === check && !check.controller.signal.aborted && check.scope === scope() && navigator.onLine
  const checkAccess = async (target: AssignmentSessionTarget, check: Check) => {
    const key = assignmentSessionKey(target)
    const version = (check.versions.get(key) ?? 0) + 1
    check.versions.set(key, version)
    try {
      const result = await readAssignmentSessionAccess(target, check.scope.projectId, check.controller.signal)
      if (!current(check) || check.versions.get(key) !== version) return
      setRead((previous) => ({ status: "available", updatedAt: null,
        value: [...(previous.status === "available" ? previous.value.filter((item) => assignmentSessionKey(item) !== key) : []), result] }))
      return result
    } catch { /* Superseded reads cannot authorize navigation. */ }
  }

  createEffect(scope, (query) => {
    const check: Check = { scope: query, controller: new AbortController(), versions: new Map() }
    active = check
    setRead({ status: "unknown" })
    if (query.enabled && query.loaded) {
      let next = 0
      if (!query.targets.length) setRead({ status: "available", value: [], updatedAt: null })
      for (let worker = 0; worker < Math.min(4, query.targets.length); worker += 1) void (async () => {
        while (current(check) && next < query.targets.length) await checkAccess(query.targets[next++], check)
      })()
    }
    return () => check.controller.abort()
  })

  return {
    online,
    sessions: (): SessionRead => {
      const value = read()
      const query = scope()
      return active?.scope === query && current(active) && query.enabled ? value : { status: "unknown" }
    },
    recheck: async (expected: AssignmentSessionTarget) => {
      const check = active
      const key = assignmentSessionKey(expected)
      const target = check?.scope.targets.find((candidate) => assignmentSessionKey(candidate) === key)
      if (!check || !target || !check.scope.enabled || !current(check)) return false
      return (await checkAccess(target, check))?.access === "accessible"
    },
  }
}
