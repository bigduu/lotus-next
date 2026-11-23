import { onCleanup, type Accessor } from "solid-js"
import { shallow } from "zustand/vanilla/shallow"
import { appStore } from "@shared/store/appStore/state"
import { agentClient, type HistoryResponse, type SessionSummary } from "@services/chat/AgentService"
import type { ManagedSessionSelection } from "@services/supervisorScope/managedSessions"

/** Navigate only after revalidating the exact directory target and its bound history. */
export function createManagedNavigation(active: Accessor<boolean>) {
  let version = 0
  onCleanup(() => { version += 1 })
  return async (id: string, selection?: ManagedSessionSelection, directoryCurrent?: () => boolean): Promise<boolean> => {
    const navigation = ++version
    const initialState = appStore.getState(), before = initialState.currentSessionId
    const initialCached = initialState.chats.find((item) => item.id === id)
    const initialRoot = selection && initialState.chats.find((item) => item.id === selection.target.root_session_id)
    const initialExecution = initialState.executionBySession
    const watched = selection ? [...new Set([id, selection.target.root_session_id])] : []
    const signature = (state: ReturnType<typeof appStore.getState>) => JSON.stringify(watched.map((key) => {
      const item = state.chats.find((chat) => chat.id === key)
      return item ? [item.createdAtExact, item.kind, item.rootSessionId, item.parentSessionId, item.config.projectId] : null
    }))
    const initialSignature = signature(initialState)
    const initialTree = selection ? initialState.chats.filter((item) => item.kind === "child" && item.rootSessionId === selection.target.root_session_id) : []
    const treeSignature = (state: ReturnType<typeof appStore.getState>) => JSON.stringify(selection ? state.chats
      .filter((item) => item.kind === "child" && item.rootSessionId === selection.target.root_session_id)
      .map((item) => [item.id, item.createdAtExact, item.parentSessionId, item.config.projectId]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))) : [])
    const initialTreeSignature = treeSignature(initialState)
    const revision = initialState.getSessionNavigationRevision()
    const navigationTargets = new Set([id, ...watched])
    if (before) navigationTargets.add(before)
    if (selection?.target.parent_session_id) navigationTargets.add(selection.target.parent_session_id)
    let identityChanged = false, treeChanged = false
    const unobserve = selection ? appStore.subscribe((state) => {
      if (signature(state) !== initialSignature) identityChanged = true
      if (treeSignature(state) !== initialTreeSignature) treeChanged = true
    }) : undefined
    try {
      const current = () => !identityChanged && active() && version === navigation && appStore.getState().currentSessionId === before
        && appStore.getState().getSessionNavigationRevision(navigationTargets) <= revision
        && (!directoryCurrent || directoryCurrent())
      let verify: (() => Promise<boolean>) | undefined
      let readBoundHistory: (() => Promise<HistoryResponse>) | undefined
      if (selection) {
        if (selection.target.session_id !== id) return false
        const selected = selection
        const { managedSessionsClient, revalidateManagedSelection } = await import("@services/supervisorScope/managedSessions")
        verify = () => revalidateManagedSelection(selected, current)
        readBoundHistory = () => managedSessionsClient.readBoundHistory(selected)
        if (!current() || !await verify()) return false
      }
      let stagedSessions: SessionSummary[] | undefined
      const initialProject = initialCached?.config.projectId ?? null
      const matchesSummary = (summary: SessionSummary) => {
        if (!selection) return false
        const target = selection.target
        return summary.id === id && summary.created_at === target.created_at && summary.kind === target.kind
          && summary.root_session_id === target.root_session_id && (summary.parent_session_id ?? null) === target.parent_session_id
          && (summary.project_id ?? null) === target.project_id
      }
      if (selection) {
        const target = selection.target
        if (initialCached && (initialCached.createdAt !== Date.parse(target.created_at) || initialCached.createdAtExact !== target.created_at
          || initialCached.kind !== target.kind || initialCached.rootSessionId !== target.root_session_id
          || (initialCached.parentSessionId ?? null) !== target.parent_session_id)) return false
        const cachedRoot = initialCached && (target.kind === "root" ? initialCached
          : appStore.getState().chats.find((item) => item.id === target.root_session_id))
        const cachedChildren = cachedRoot && appStore.getState().chats.filter((item) => item.kind === "child" && item.rootSessionId === cachedRoot.id).length
        const needsTree = cachedRoot?.kind === "root" && cachedChildren !== (cachedRoot.subagentCount ?? 0)
        if (!initialCached || initialProject !== target.project_id || needsTree) {
          const detail = await agentClient.getSession(id)
          if (!current() || !matchesSummary(detail.session)) return false
          stagedSessions = await appStore.getState().stageSessionForNavigation(detail.session) ?? undefined
          if (!stagedSessions) return false
          // Include cold descendants before admitting a staged tree. An
          // in-flight deletion may predate the local cache of that row.
          for (const staged of stagedSessions) navigationTargets.add(staged.id)
          if (!current()) return false
        }
      } else {
        const restored = await appStore.getState().restoreSession(id)
        if (!restored || !current()) return false
      }
      const matchesCached = () => {
        if (!selection) return true
        const target = selection.target, state = appStore.getState(), cached = state.chats.find((item) => item.id === id)
        if (stagedSessions && (cached !== initialCached || treeChanged || initialTree.some((item) =>
          state.chats.find((chat) => chat.id === item.id) !== item) || stagedSessions.some((item) => {
            const existing = state.chats.find((chat) => chat.id === item.id)
            const previous = initialExecution[item.id], execution = state.executionBySession[item.id]
            // An index refresh advances syncedAt even when execution is unchanged.
            const executionChanged = execution !== previous && (!execution || !previous
              || !shallow(execution, { ...previous, backend: execution.backend })
              || !shallow(execution.backend, { ...previous.backend, syncedAt: execution.backend.syncedAt }))
            return (existing && (existing.createdAtExact !== item.created_at || existing.kind !== item.kind
              || existing.rootSessionId !== item.root_session_id || (existing.parentSessionId ?? null) !== (item.parent_session_id ?? null)))
              || executionChanged
          }))) return false
        const stagedTarget = stagedSessions?.find((item) => item.id === id)
        const stagedRoot = stagedSessions?.find((item) => item.id === target.root_session_id)
        const cachedRoot = stagedRoot && appStore.getState().chats.find((item) => item.id === stagedRoot.id)
        if (stagedRoot && (cachedRoot !== initialRoot || cachedRoot && (cachedRoot.kind !== "root" || cachedRoot.createdAtExact !== stagedRoot.created_at))) return false
        if (!cached) return !!stagedTarget && matchesSummary(stagedTarget)
        return cached.createdAt === Date.parse(target.created_at) && cached.createdAtExact === target.created_at && cached.kind === target.kind
          && cached.rootSessionId === target.root_session_id && (cached.parentSessionId ?? null) === target.parent_session_id
          && ((cached.config.projectId ?? null) === target.project_id
            || !!initialCached && !!stagedTarget && (cached.config.projectId ?? null) === initialProject && matchesSummary(stagedTarget))
      }
      if (!matchesCached()) return false
      try {
        await appStore.getState().loadChatHistory(id, {
          throwOnError: true,
          ...(stagedSessions ? { stagedSessions } : {}),
          ...(verify ? {
            readHistory: readBoundHistory,
            managedSelection: selection,
            beforeApply: async () => current() && matchesCached() && Boolean(await verify?.()),
            canApply: () => current() && matchesCached(),
            selectOnApply: true,
          } : {}),
        })
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return false
        throw error
      }
      if (selection) return true
      if (!current() || !matchesCached()) return false
      appStore.getState().selectSession(id)
      return true
    } finally { unobserve?.() }
  }
}
