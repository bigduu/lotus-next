import { beforeEach, expect, it, vi } from "vitest"
import { ticketClient } from "./client"
import { ticketSnapshot } from "./testFixtures"
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
