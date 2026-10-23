import { beforeEach, expect, it, vi } from "vitest"
import { ticketClient } from "./client"
import { initializableTicketScope, readyTicketScopeV1, ticketSnapshot } from "./testFixtures"
import { ApiError, apiClient } from "@services/api"
vi.mock("@services/api", async (original) => ({ ...await original<typeof import("@services/api")>(), apiClient: { get: vi.fn(), post: vi.fn(), postOnce: vi.fn() } }))
beforeEach(() => { vi.resetAllMocks() })

it("preserves distinct unsupported and unbound negotiation outcomes", async () => {
  const value = ticketSnapshot()
  vi.mocked(apiClient.get).mockRejectedValueOnce(new ApiError("old backend", 404, "Not Found"))
  await expect(ticketClient.load("root")).rejects.toMatchObject({ kind: "unsupported" })
  vi.mocked(apiClient.get).mockResolvedValueOnce(value.scope)
  await expect(ticketClient.load("another-session")).rejects.toMatchObject({ kind: "unbound" })
  value.scope.capabilities!.precise_request_response_v1 = false
  vi.mocked(apiClient.get).mockResolvedValueOnce(value.scope)
  await expect(ticketClient.load("root")).rejects.toMatchObject({ kind: "unsupported" })
  expect(apiClient.post).not.toHaveBeenCalled()
})

it("pins every search page and selected inspector to one commit despite later writes", async () => {
  const value = ticketSnapshot()
  vi.mocked(apiClient.get).mockResolvedValue(value.scope)
  let page = 0
  vi.mocked(apiClient.post).mockImplementation(async (path, body) => {
    expect((body as { fixed_commit: string }).fixed_commit).toBe(value.snapshot.commit)
    if (path === "tickets/search") {
      const cursor = ++page === 1 ? { commit: value.snapshot.commit, query_hash: "query", offset: 1 } : null
      return { ...value.scope.overview, data: [{ id: page === 1 ? "A" : "E", kind: "work" }], next_cursor: cursor }
    }
    const id = (body as { ids: string[] }).ids[0]
    expect((body as { sections: string[] }).sections).toEqual(["assignments", "requests", "submissions"])
    return { ...value.scope.overview, data: value.views.filter((v) => v.ticket.id === id) }
  })
  const loaded = await ticketClient.load("root")
  expect(loaded?.views.map((v) => v.ticket.id)).toEqual(["A", "E"])
  expect(loaded?.complete).toBe(true)
  expect(apiClient.post).toHaveBeenCalledTimes(4)
})

it("marks lagging index coverage partial and fails mixed metadata/snapshot identity", async () => {
  const value = ticketSnapshot(); value.scope.overview.index_seq = 9
  vi.mocked(apiClient.get).mockResolvedValue(value.scope)
  vi.mocked(apiClient.post).mockResolvedValue({ ...value.scope.overview, data: [], next_cursor: null })
  expect((await ticketClient.load("root"))?.complete).toBe(false)
  vi.mocked(apiClient.post).mockResolvedValue({ ...value.scope.overview, snapshot: { ...value.snapshot, seq: 11 }, data: [] })
  await expect(ticketClient.load("root")).rejects.toThrow("快照不一致")
})

it("keeps scope and other Work views when one immutable Work exceeds the inspection budget", async () => {
  const value = ticketSnapshot()
  vi.mocked(apiClient.get).mockResolvedValue(value.scope)
  vi.mocked(apiClient.post).mockImplementation(async (path, body) => {
    expect((body as { fixed_commit: string }).fixed_commit).toBe(value.snapshot.commit)
    if (path === "tickets/search") return { ...value.scope.overview, data: [{ id: "A", kind: "work" }, { id: "E", kind: "work" }] }
    const id = (body as { ids: string[] }).ids[0]
    if (id === "A") throw new ApiError("context_budget_exceeded", 422, "Unprocessable Entity")
    return { ...value.scope.overview, data: value.views.filter((v) => v.ticket.id === id) }
  })
  const loaded = await ticketClient.load("root")
  expect(loaded?.scope).toEqual(value.scope)
  expect(loaded?.views.map((v) => v.ticket.id)).toEqual(["E"])
  expect(loaded?.complete).toBe(false)
  expect(loaded?.scope.capabilities?.semantic_messages_v1).toBe(true)
})

it("does not hide a different inspector rejection as incomplete coverage", async () => {
  const value = ticketSnapshot()
  vi.mocked(apiClient.get).mockResolvedValue(value.scope)
  vi.mocked(apiClient.post).mockImplementation(async (path) => {
    if (path === "tickets/search") return { ...value.scope.overview, data: [{ id: "A", kind: "work" }] }
    throw new ApiError("invalid_transition", 422, "Unprocessable Entity")
  })
  await expect(ticketClient.load("root")).rejects.toThrow("invalid_transition")
})

it.each([{ truncated: true, omitted_count: 0 }, { truncated: false, omitted_count: 1 }])("keeps incomplete search envelopes read-only even without a cursor: %j", async (flags) => {
  const value = ticketSnapshot()
  vi.mocked(apiClient.get).mockResolvedValue(value.scope)
  vi.mocked(apiClient.post).mockResolvedValue({ ...value.scope.overview, ...flags, data: [], next_cursor: null })
  expect((await ticketClient.load("root"))?.complete).toBe(false)
})


it.each([
  ["authority_unavailable: Ticket mutation feature is disabled", "disabled"],
  ["authority_unavailable: existing Supervisor needs explicit attach/import; no automatic takeover", "uninitialized"],
  ["authority_unavailable: damaged HEAD", "error"],
  ["scope_denied: Supervisor scope binding changed", "error"],
  ["", "error"],
] as const)("retains the unavailable scope reason %s as %s", async (reason, kind) => {
  vi.mocked(apiClient.get).mockResolvedValue({ available: false, reason, mutation_enabled: false, dispatch_enabled: false })
  await expect(ticketClient.load("root")).rejects.toMatchObject({ kind, message: reason })
  expect(apiClient.post).not.toHaveBeenCalled()
})

it.each([null, {}, { available: true }, { ...ticketSnapshot().scope, overview: undefined },
  { ...ticketSnapshot().scope, mutation_enabled: undefined }, { ...ticketSnapshot().scope, health: undefined }])("reports an invalid capability response instead of manufacturing no scope: %j", async (body) => {
  vi.mocked(apiClient.get).mockResolvedValue(body)
  await expect(ticketClient.load("root")).rejects.toThrow("能力响应不完整")
  expect(apiClient.post).not.toHaveBeenCalled()
})

it.each([401, 403, 503])("retains HTTP %s for the hook to distinguish access and service failures", async (status) => {
  const failure = new ApiError("exact HTTP failure", status, "failure")
  vi.mocked(apiClient.get).mockRejectedValue(failure)
  await expect(ticketClient.load("root")).rejects.toBe(failure)
})

it("loads a valid zero-Work scope as a complete ready snapshot", async () => {
  const value = ticketSnapshot()
  value.scope.overview.data = { ticket_count: 0, work_count: 0, states: {}, open_questions: 0, open_approvals: 0, needs_acceptance: 0 }
  vi.mocked(apiClient.get).mockResolvedValue(value.scope)
  vi.mocked(apiClient.post).mockResolvedValue({ ...value.scope.overview, data: [] })
  expect(await ticketClient.load("root")).toMatchObject({ scope: value.scope, views: [], complete: true })
  expect(apiClient.post).toHaveBeenCalledTimes(1)
})


const initialization = { supervisor_session_id: "root", incarnation_id: "11111111-1111-4111-8111-111111111111", binding_revision: 1 }
const initializedScope = () => {
  return readyTicketScopeV1()
}

it.each([true, false])("submits only the exact three initialization fields once and verifies created=%s", async (created) => {
  vi.mocked(apiClient.postOnce).mockResolvedValue({ created, scope: initializedScope() })
  expect(await ticketClient.initialize({ ...initialization, history: "never submit", mode: "ultra" } as typeof initialization)).toEqual({ created, scope: initializedScope() })
  expect(apiClient.postOnce).toHaveBeenCalledExactlyOnceWith("tickets/initialize", initialization)
  expect(apiClient.get).not.toHaveBeenCalled()
  expect(apiClient.post).not.toHaveBeenCalled()
})

it.each(["created", "session", "incarnation", "revision", "scope"])("rejects an unconfirmed initialization %s receipt", async (changed) => {
  const response: Record<string, unknown> = { created: true, scope: initializedScope() }
  if (changed === "created") response.created = "yes"
  else if (changed === "scope") response.scope = null
  else {
    const scope = response.scope as ReturnType<typeof initializedScope>
    if (changed === "session") scope.binding.supervisor_session_id = "other"
    if (changed === "incarnation") scope.binding.scope_id = "supervisor/other"
    if (changed === "revision") scope.binding.binding_revision = 2
  }
  vi.mocked(apiClient.postOnce).mockResolvedValue(response)
  await expect(ticketClient.initialize(initialization)).rejects.toThrow()
  expect(apiClient.postOnce).toHaveBeenCalledTimes(1)
})

it.each([409, 403, 503])("preserves initialization HTTP %s without transport replay", async (status) => {
  const failure = new ApiError("exact initialize refusal", status, "failure")
  vi.mocked(apiClient.postOnce).mockRejectedValue(failure)
  await expect(ticketClient.initialize(initialization)).rejects.toBe(failure)
  expect(apiClient.postOnce).toHaveBeenCalledTimes(1)
})


it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])("does not submit an unsafe initialization revision %s", async (bindingRevision) => {
  await expect(ticketClient.initialize({ ...initialization, binding_revision: bindingRevision })).rejects.toThrow()
  expect(apiClient.postOnce).not.toHaveBeenCalled()
})

it("retains the exact v1 empty-scope confirmation and stable reason without parsing prose", async () => {
  const body = initializableTicketScope(); body.reason = "任意服务说明 disabled forbidden"
  vi.mocked(apiClient.get).mockResolvedValue(body)
  const failure = await ticketClient.load("root").catch((error) => error)
  expect(failure).toMatchObject({ kind: "uninitialized", presentation: {
    kind: "uninitialized", detail: body.reason, reasonCode: "scope_uninitialized", initialization: body.initialization,
  } })
  expect(apiClient.post).not.toHaveBeenCalled()
  expect(apiClient.postOnce).not.toHaveBeenCalled()
})

it.each([
  ["disabled", "ticket_mutation_disabled"], ["forbidden", "supervisor_mode_required"],
  ["forbidden", "supervisor_identity_mismatch"], ["forbidden", "scope_binding_mismatch"],
  ["error", "scope_requires_recovery"], ["error", "scope_io_error"],
] as const)("preserves v1 %s/%s without a setup command", async (kind, reasonCode) => {
  vi.mocked(apiClient.get).mockResolvedValue({ ...initializableTicketScope(), can_initialize: false, initialization: null,
    availability: { kind, reason_code: reasonCode } })
  await expect(ticketClient.load("root")).rejects.toMatchObject({ presentation: { kind, reasonCode } })
  expect(apiClient.postOnce).not.toHaveBeenCalled()
})

// Independent oracle from Bamboo a473 status_for_platform, not the client parser.
const frozenScopePairs = [
  ["ready", "scope_ready"], ["uninitialized", "scope_uninitialized"],
  ["disabled", "ticket_mutation_disabled"], ["forbidden", "supervisor_mode_required"],
  ["forbidden", "supervisor_identity_mismatch"], ["forbidden", "scope_binding_mismatch"],
  ["error", "scope_requires_recovery"], ["error", "scope_io_error"],
] as const
const frozenScopeKinds = ["ready", "uninitialized", "disabled", "forbidden", "error"] as const
const scopePairCases = frozenScopeKinds.flatMap((kind) => frozenScopePairs.map(([, reasonCode]) =>
  [kind, reasonCode, frozenScopePairs.some(([expectedKind, expectedReason]) => kind === expectedKind && reasonCode === expectedReason)] as const))

it.each(scopePairCases)("enforces the frozen v1 kind/reason contract: %s/%s", async (kind, reasonCode, valid) => {
  const scope = { ...readyTicketScopeV1(), available: kind === "ready", readable: kind === "ready",
    availability: { kind, reason_code: reasonCode }, can_initialize: false, initialization: null }
  vi.mocked(apiClient.get).mockResolvedValue(scope)
  const result = ticketClient.scope("root")
  if (!valid) await expect(result).rejects.toThrow("能力响应不完整")
  else if (kind === "ready") await expect(result).resolves.toEqual(scope)
  else await expect(result).rejects.toMatchObject({ presentation: { kind, reasonCode } })
  expect(apiClient.get).toHaveBeenCalledExactlyOnceWith("tickets/scope", { signal: undefined })
  expect(apiClient.post).not.toHaveBeenCalled()
  expect(apiClient.postOnce).not.toHaveBeenCalled()
})

it("keeps an existing v1 scope readable with both operation flags disabled", async () => {
  const scope = readyTicketScopeV1(); scope.mutation_enabled = false; scope.dispatch_enabled = false
  vi.mocked(apiClient.get).mockResolvedValue(scope)
  vi.mocked(apiClient.post).mockResolvedValue({ ...scope.overview, data: [] })
  expect(await ticketClient.load("root")).toMatchObject({ scope, complete: true })
})

it.each([
  { availability: undefined }, { availability: { kind: "future", reason_code: "scope_uninitialized" } },
  { availability: { kind: "uninitialized", reason_code: "unknown" } }, { readable: true },
  { can_initialize: undefined }, { initialization: null }, { initialization: { ...initialization, supervisor_session_id: "another" } },
  { initialization: { ...initialization, incarnation_id: "not-a-uuid" } }, { initialization: { ...initialization, binding_revision: 0 } },
  { capabilities: { scope_initialize_v1: false } }, { mutation_enabled: false },
  { can_initialize: false },
])("never exposes unsafe or contradictory v1 initialization eligibility: %j", async (patch) => {
  vi.mocked(apiClient.get).mockResolvedValue({ ...initializableTicketScope(), ...patch })
  await expect(ticketClient.load("root")).rejects.toThrow("能力响应不完整")
  expect(apiClient.postOnce).not.toHaveBeenCalled()
})

it("rejects a legacy-shaped initialization acknowledgement even if its old scope is readable", async () => {
  const legacy = ticketSnapshot().scope; legacy.binding.scope_id = "supervisor/" + initialization.incarnation_id
  vi.mocked(apiClient.postOnce).mockResolvedValue({ created: true, scope: legacy })
  await expect(ticketClient.initialize(initialization)).rejects.toThrow("无法确认初始化响应")
  expect(apiClient.postOnce).toHaveBeenCalledTimes(1)
})


it.each([false, true])("bounds assignment inspection while preserving canonical Work decisions; mixed fallback=%s", async (mixed) => {
  const value = ticketSnapshot()
  vi.mocked(apiClient.get).mockResolvedValue(value.scope)
  vi.mocked(apiClient.post).mockImplementation(async (path, body) => {
    expect((body as { fixed_commit: string }).fixed_commit).toBe(value.snapshot.commit)
    if (path === "tickets/search") return { ...value.scope.overview, data: [{ id: "A", kind: "work" }] }
    const sections = (body as { sections: string[] }).sections
    if (sections.includes("assignments")) throw new ApiError("context_budget_exceeded", 422, "Unprocessable Entity")
    expect(sections).toEqual(["requests", "submissions"])
    return { ...value.scope.overview, snapshot: mixed ? { ...value.snapshot, commit: "different" } : value.snapshot,
      data: [{ ...value.views[0], assignments: [], sections }] }
  })
  if (mixed) await expect(ticketClient.load("root")).rejects.toThrow("快照不一致")
  else {
    const loaded = await ticketClient.load("root")
    expect(loaded?.complete).toBe(true)
    expect(loaded?.views[0].ticket.id).toBe("A")
    expect(loaded?.views[0].sections).toEqual(["requests", "submissions"])
  }
  expect(apiClient.post).toHaveBeenCalledTimes(3)
})
