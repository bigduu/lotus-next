import { beforeEach, expect, it, vi } from "vitest"
import { ticketClient } from "./client"
import { ticketSnapshot } from "./testFixtures"
import { ApiError, apiClient } from "@services/api"
vi.mock("@services/api", async (original) => ({ ...await original<typeof import("@services/api")>(), apiClient: { get: vi.fn(), post: vi.fn(), postOnce: vi.fn() } }))
beforeEach(() => { vi.resetAllMocks() })

it("negotiates exact capabilities/binding and preserves legacy behavior when absent", async () => {
  const value = ticketSnapshot()
  vi.mocked(apiClient.get).mockRejectedValueOnce(new ApiError("old backend", 404, "Not Found"))
  expect(await ticketClient.load("root")).toBeNull()
  vi.mocked(apiClient.get).mockResolvedValueOnce(value.scope)
  expect(await ticketClient.load("another-session")).toBeNull()
  value.scope.capabilities!.precise_request_response_v1 = false
  vi.mocked(apiClient.get).mockResolvedValueOnce(value.scope)
  expect(await ticketClient.load("root")).toBeNull()
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
