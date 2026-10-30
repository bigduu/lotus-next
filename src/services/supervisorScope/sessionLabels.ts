import { apiClient } from "@services/api"
import type { ManagedSessionLink, SessionCandidate } from "./managedSessions"

const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
const safeId = (value: string) => value.length > 0 && value.length <= 256 && value.trim() === value && value !== "." && !value.includes("..")
  && !value.includes("/") && !value.includes("\\") && ![...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) >= 127 && character.charCodeAt(0) <= 159)
  && value !== "bamboo-default-supervisor"

export async function describe(links: readonly ManagedSessionLink[], signal?: AbortSignal): Promise<readonly SessionCandidate[]> {
  // These non-authoritative labels must never block the canonical directory.
  // Bound both the page size and request concurrency; a changed or missing
  // session keeps its ID rather than inheriting another incarnation's title.
  if (links.length > 20) return []
  const result: (SessionCandidate | null)[] = links.map(() => null)
  let index = 0
  const worker = async () => {
    while (!signal?.aborted) {
      const position = index++
      if (position >= links.length) return
      const target = links[position]?.current_user_target
      if (!target || !safeId(target.session_id)) continue
      try {
        const body = record(await apiClient.get<unknown>(`sessions/${encodeURIComponent(target.session_id)}`, { signal, cache: "no-store" }))
        const session = record(body?.session)
        if (!session || session.id !== target.session_id || session.created_at !== target.created_at || session.kind !== target.kind
          || session.root_session_id !== target.root_session_id || (session.parent_session_id ?? null) !== target.parent_session_id
          || (session.project_id ?? null) !== target.project_id || typeof session.title !== "string"
          || typeof session.model !== "string" || typeof session.is_running !== "boolean") continue
        result[position] = { session_id: target.session_id, title: session.title, project_id: target.project_id, model: session.model,
          is_running: session.is_running, ...(typeof session.last_run_status === "string" ? { last_run_status: session.last_run_status } : {}),
          observedTarget: { ...target } }
      } catch { /* Details are optional; the canonical row remains visible. */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, links.length) }, worker))
  return result.filter((summary): summary is SessionCandidate => summary !== null)

}
