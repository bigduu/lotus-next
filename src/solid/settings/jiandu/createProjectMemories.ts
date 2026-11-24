import { createMemo, createSignal, onSettled } from "solid-js"
import { appStore } from "@shared/store/appStore/state"
import {
  createLookupQuery, JianduMemoryApiError, normalizeCreateProjectMemoryInput, sameJianduProjectContext,
  type CreateProjectMemoryInput, type JianduMemoryApiClient, type JianduMemoryDetail,
  type JianduMemoryListItem, type JianduMemoryPage, type JianduMemoryType, type JianduProjectContext,
} from "@/services/memory/jianduMemoryApi"

type UiError = "invalid" | "context" | "denied" | "unavailable" | "rejected" | "malformed"
type Notice = { kind: "created" | "archived" | "createdRefreshFailed" | "archivedRefreshFailed"; title: string }
type Filter = "active" | "archived"
type Search = { query: string; status: Filter }
interface Draft {
  title: string
  type: JianduMemoryType
  content: string
  tags: string
  keywords: string
  entities: string
  granularity: string
}

const initialDraft: Draft = { title: "", type: "project", content: "", tags: "", keywords: "", entities: "", granularity: "" }
const initialSearch: Search = { query: "", status: "active" }

function errorKey(error: unknown): UiError {
  if (!(error instanceof JianduMemoryApiError)) return "unavailable"
  switch (error.code) {
    case "invalid_input": return "invalid"
    case "context_unavailable": return "context"
    case "access_denied": return "denied"
    case "action_rejected": return "rejected"
    case "malformed_response": return "malformed"
    case "request_failed": return "unavailable"
  }
}

function draftInput(draft: Draft): CreateProjectMemoryInput {
  const csv = (value: string) => value.split(",").map((part) => part.trim()).filter(Boolean)
  return {
    title: draft.title, content: draft.content, type: draft.type,
    tags: csv(draft.tags), keywords: csv(draft.keywords), entities: csv(draft.entities),
    ...(draft.granularity ? { granularity: draft.granularity as CreateProjectMemoryInput["granularity"] } : {}),
  }
}

function mergeItems(previous: JianduMemoryListItem[], current: JianduMemoryListItem[]) {
  return [...new Map([...previous, ...current].map((item) => [item.id, item])).values()]
}

export function createProjectMemories(sessionId: string, api: JianduMemoryApiClient) {
  const [context, setContext] = createSignal<JianduProjectContext | null>(null)
  const [contextLoading, setContextLoading] = createSignal(true)
  const [contextError, setContextError] = createSignal<UiError | null>(null)
  const [query, setQuery] = createSignal("")
  const [filter, setFilter] = createSignal<Filter>("active")
  const [applied, setApplied] = createSignal(initialSearch)
  const [items, setItems] = createSignal<JianduMemoryListItem[]>([])
  const [page, setPage] = createSignal<JianduMemoryPage | null>(null)
  const [listLoading, setListLoading] = createSignal(false)
  const [listError, setListError] = createSignal<UiError | null>(null)
  const [detail, setDetail] = createSignal<JianduMemoryDetail | null>(null)
  const [detailLoading, setDetailLoading] = createSignal<string | null>(null)
  const [detailError, setDetailError] = createSignal<UiError | null>(null)
  const [creating, setCreating] = createSignal(false)
  const [draft, setDraft] = createSignal(initialDraft)
  const [preflight, setPreflight] = createSignal<{ fingerprint: string; matches: JianduMemoryPage } | null>(null)
  const [preflightLoading, setPreflightLoading] = createSignal(false)
  const [createError, setCreateError] = createSignal<UiError | null>(null)
  const [archiveTarget, setArchiveTarget] = createSignal<JianduMemoryDetail | null>(null)
  const [archiveError, setArchiveError] = createSignal<UiError | null>(null)
  const [mutation, setMutation] = createSignal<"create" | "archive" | null>(null)
  const [notice, setNotice] = createSignal<Notice | null>(null)

  let mounted = true
  let epoch = 0
  let listRequest = 0
  let detailRequest = 0
  let preflightRequest = 0
  const current = (version = epoch) => mounted && version === epoch && appStore.getState().currentSessionId === sessionId

  function reset() {
    epoch += 1
    setContext(null)
    setQuery("")
    setFilter("active")
    setApplied(initialSearch)
    setItems([])
    setPage(null)
    setListError(null)
    setListLoading(false)
    closeDetail()
    setCreating(false)
    setDraft(initialDraft)
    setPreflight(null)
    setPreflightLoading(false)
    setCreateError(null)
    setMutation(null)
    setNotice(null)
  }

  async function loadList(scope: JianduProjectContext, search: Search, cursor?: string) {
    const version = epoch
    const request = ++listRequest
    const valid = () => current(version) && request === listRequest
    setListLoading(true)
    setListError(null)
    try {
      const result = await api.queryProjectMemories(scope, { query: search.query, filters: { status: [search.status] }, ...(cursor ? { cursor } : {}) })
      if (!valid()) return "stale"
      setItems((previous) => cursor ? mergeItems(previous, result.items) : result.items)
      setPage(result)
      return "ok"
    } catch (error) {
      if (!valid()) return "stale"
      setListError(errorKey(error))
      if (!cursor) { setItems([]); setPage(null) }
      return "failed"
    } finally {
      if (valid()) setListLoading(false)
    }
  }

  async function loadContext() {
    if (!current()) return
    reset()
    const version = epoch
    setContextLoading(true)
    setContextError(null)
    try {
      const resolved = await api.resolveProjectContext(sessionId)
      if (!current(version)) return
      setContext(resolved)
      void loadList(resolved, initialSearch)
    } catch (error) {
      if (current(version)) setContextError(errorKey(error))
    } finally {
      if (current(version)) setContextLoading(false)
    }
  }

  onSettled(() => {
    void loadContext()
    return () => { mounted = false; epoch += 1 }
  })

  function search() {
    const scope = context()
    if (!current() || !scope || listLoading() || mutation()) return
    const next = { query: query().trim(), status: filter() }
    setApplied(next)
    setNotice(null)
    void loadList(scope, next)
  }

  function refresh(loadMore = false) {
    const scope = context()
    const cursor = loadMore ? page()?.nextCursor : undefined
    if (!current() || !scope || listLoading() || mutation() || (loadMore && !cursor)) return
    void loadList(scope, applied(), cursor)
  }

  async function openDetail(item: JianduMemoryListItem) {
    const scope = context()
    if (!current() || !scope) return
    const version = epoch
    const request = ++detailRequest
    const valid = () => current(version) && request === detailRequest
    setDetail(null)
    setDetailLoading(item.id)
    setDetailError(null)
    try {
      const result = await api.getProjectMemory(scope, item.id)
      if (valid()) setDetail(result)
    } catch (error) {
      if (valid()) setDetailError(errorKey(error))
    } finally {
      if (valid()) setDetailLoading(null)
    }
  }

  function closeArchive() {
    if (mutation() === "archive") return
    setArchiveTarget(null)
    setArchiveError(null)
  }

  function closeDetail() {
    ++detailRequest
    setDetail(null)
    setDetailLoading(null)
    setDetailError(null)
    setArchiveTarget(null)
    setArchiveError(null)
  }

  function openArchive() {
    const target = detail()
    if (!current() || !target || mutation() || target.status === "archived") return
    setArchiveError(null)
    setArchiveTarget(target)
  }

  const fingerprint = createMemo(() => JSON.stringify(draft()))
  function clearPreflight() {
    ++preflightRequest
    setPreflight(null)
    setPreflightLoading(false)
    setCreateError(null)
  }

  function updateDraft<K extends keyof Draft>(key: K, value: Draft[K]) {
    if (mutation()) return
    setDraft((before) => ({ ...before, [key]: value }))
    clearPreflight()
  }

  function openCreate() {
    if (!current() || !context() || mutation()) return
    setDraft(initialDraft)
    clearPreflight()
    setCreating(true)
  }

  function closeCreate() {
    if (mutation() === "create") return
    setCreating(false)
    setDraft(initialDraft)
    clearPreflight()
  }

  function validatedDraft() {
    try {
      const input = draftInput(draft())
      normalizeCreateProjectMemoryInput(input)
      return input
    } catch (error) {
      setCreateError(errorKey(error))
      return null
    }
  }

  async function runPreflight() {
    const scope = context()
    if (!current() || !scope || preflightLoading() || mutation()) return
    const input = validatedDraft()
    if (!input) return
    const requestedDraft = fingerprint()
    const request = ++preflightRequest
    const version = epoch
    const valid = () => current(version) && request === preflightRequest
    setPreflightLoading(true)
    setPreflight(null)
    setCreateError(null)
    try {
      const inventory = await api.queryProjectMemories(scope, { query: "", limit: 1 })
      if (!valid()) return
      const matches = inventory.matchedCount === 0 ? inventory : await api.queryProjectMemories(scope, { query: createLookupQuery(input), limit: 5 })
      if (valid()) setPreflight({ fingerprint: requestedDraft, matches })
    } catch (error) {
      if (valid()) setCreateError(errorKey(error))
    } finally {
      if (valid()) setPreflightLoading(false)
    }
  }

  async function reauthorize(expected: JianduProjectContext, version: number) {
    let failure: UiError = "context"
    try {
      const fresh = await api.resolveProjectContext(sessionId)
      if (!current(version)) return null
      if (sameJianduProjectContext(expected, fresh)) return fresh
    } catch (error) {
      failure = errorKey(error)
    }
    if (current(version)) {
      reset()
      setContextError(failure)
      setContextLoading(false)
    }
    return null
  }

  const canConfirmCreate = () => !!preflight() && preflight()?.fingerprint === fingerprint() && !mutation()
  async function createMemory() {
    const scope = context()
    if (!current() || !scope || !canConfirmCreate()) return
    const input = validatedDraft()
    if (!input) return
    const version = epoch
    setMutation("create")
    setCreateError(null)
    try {
      const fresh = await reauthorize(scope, version)
      if (!fresh || !current(version)) return
      const created = await api.createProjectMemory(fresh, input)
      if (!current(version)) return
      setCreating(false)
      setDraft(initialDraft)
      clearPreflight()
      const result = await loadList(fresh, applied())
      if (current(version) && result !== "stale") {
        setNotice({ kind: result === "ok" ? "created" : "createdRefreshFailed", title: created.title })
      }
    } catch (error) {
      if (current(version)) setCreateError(errorKey(error))
    } finally {
      if (current(version)) setMutation(null)
    }
  }

  async function archiveMemory() {
    const target = archiveTarget()
    const scope = context()
    if (!current() || !scope || !target || mutation()) return
    const version = epoch
    setMutation("archive")
    setArchiveError(null)
    try {
      const fresh = await reauthorize(scope, version)
      if (!fresh || !current(version)) return
      await api.archiveProjectMemory(fresh, target.id)
      if (!current(version)) return
      closeDetail()
      const result = await loadList(fresh, applied())
      if (current(version) && result !== "stale") {
        setNotice({ kind: result === "ok" ? "archived" : "archivedRefreshFailed", title: target.title })
      }
    } catch (error) {
      if (current(version)) setArchiveError(errorKey(error))
    } finally {
      if (current(version)) setMutation(null)
    }
  }

  return {
    context, contextLoading, contextError, loadContext,
    query, setQuery, filter, setFilter, items, page, listLoading, listError, search, refresh,
    detail, detailLoading, detailError, openDetail, closeDetail,
    creating, draft, preflight, preflightLoading, createError, runPreflight, openCreate, updateDraft, closeCreate, canConfirmCreate, createMemory,
    archiveTarget, archiveError, openArchive, closeArchive, archiveMemory, mutation, notice,
  }
}
