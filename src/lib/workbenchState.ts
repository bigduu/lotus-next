import type { RightWorkbenchTab, WorkbenchToolTab } from "@/lib/workbenchTabTypes"

export type WorkbenchSubagents = {
  childId: string | null
  view: "tree" | "messages"
  expandedActorIds?: string[]
}

export interface WorkbenchState {
  open: boolean
  dockWidth: number | null
  tab: RightWorkbenchTab | null
  tools: WorkbenchToolTab[]
  order: string[]
  subagents: WorkbenchSubagents
  reviewTarget: string | null
  browserActiveId: string | null
  browserPresent: boolean
}
const tools: WorkbenchToolTab[] = ["work", "inspector", "review", "subagents", "task-dag", "side-chat"]
export const emptyWorkbenchState = (): WorkbenchState => ({
  open: false, dockWidth: null, tab: null, tools: [], order: [], subagents: { childId: null, view: "tree" },
  reviewTarget: null, browserActiveId: null, browserPresent: false,
})
const identifier = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 4096

export function workbenchStorageKey(backend: string, sessionId: string | null): string | null {
  if (!sessionId) return null
  // Endpoint identity only: never put credentials, query parameters or fragments in storage.
  const url = new URL(backend)
  return `lotus-next.workbench.v1:${encodeURIComponent(url.origin + url.pathname)}:${encodeURIComponent(sessionId)}`
}

export function readWorkbenchState(key: string | null): WorkbenchState {
  const fallback = emptyWorkbenchState()
  if (!key) return fallback
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null")
    if (!value || (value.version !== 1 && value.version !== 2) || !value.state || typeof value.state !== "object") return fallback
    const item = value.state
    const migrateTab = (tab: unknown): unknown => value.version === 1 && tab === "session" ? "subagents" : tab
    const savedTools = Array.isArray(item.tools) ? [...new Set<WorkbenchToolTab>(
      item.tools.map(migrateTab).filter((tool: unknown): tool is WorkbenchToolTab => tools.includes(tool as WorkbenchToolTab)),
    )] : []
    const tab = migrateTab(item.tab)
    // Both old and new stored IDs are only candidates until the current actor
    // snapshot proves the child belongs to this session's root.
    const childId = value.version === 1 ? item.secondSid : item.subagents?.childId
    return {
      open: item.open === true,
      dockWidth: typeof item.dockWidth === "number" && Number.isFinite(item.dockWidth) && item.dockWidth > 0
        ? item.dockWidth : null,
      tab: tab === "browser" || savedTools.includes(tab as WorkbenchToolTab) ? tab as RightWorkbenchTab : null,
      tools: savedTools,
      order: Array.isArray(item.order) ? [...new Set<string>(item.order
        .map((id: unknown) => value.version === 1 && id === "tool:session" ? "tool:subagents" : id)
        .filter((id: unknown): id is string =>
          identifier(id) && (id.startsWith("browser:") || tools.some((tool) => id === "tool:" + tool)),
        ))].slice(0, 200) : [],
      subagents: {
        childId: identifier(childId) ? childId : null,
        view: identifier(childId) && (value.version === 1 || item.subagents?.view === "messages") ? "messages" : "tree",
        ...(Array.isArray(item.subagents?.expandedActorIds)
          ? { expandedActorIds: [...new Set<string>(item.subagents.expandedActorIds.filter(identifier))].slice(0, 256) }
          : {}),
      },
      reviewTarget: identifier(item.reviewTarget) ? item.reviewTarget : null,
      browserActiveId: identifier(item.browserActiveId) ? item.browserActiveId : null,
      browserPresent: item.browserPresent === true,
    }
  } catch { return fallback }
}

export function activateWorkbenchTab(state: WorkbenchState, tab: RightWorkbenchTab): WorkbenchState {
  return {
    ...state,
    open: true,
    tab,
    tools: tab === "browser" || state.tools.includes(tab) ? state.tools : [...state.tools, tab],
  }
}

export function writeWorkbenchState(key: string, state: WorkbenchState) {
  try { localStorage.setItem(key, JSON.stringify({ version: 2, state })) } catch {
    // Keep the in-memory view usable when storage is disabled or full.
  }
}
