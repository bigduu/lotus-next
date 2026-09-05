import { beforeEach, describe, expect, it, vi } from "vitest"
import { apiClient } from "../api"
import {
  JianduMemoryApi,
  createLookupQuery,
  normalizeCreateProjectMemoryInput,
  sameJianduProjectContext,
  type CreateProjectMemoryInput,
  type JianduProjectContext,
} from "./jianduMemoryApi"

const context: JianduProjectContext = {
  activeSessionId: "root-1",
  activeSessionTitle: "Project conversation",
  authoritySessionId: "root-1",
  authoritySessionTitle: "Project conversation",
  projectId: "project-1",
}
const record = {
  id: "project-memory-1", title: "Release decision", type: "project", scope: "project",
  project_key: "project-1", status: "active", summary: "Keep the native writer", tags: ["release"],
}
const queryPayload = {
  action: "query", success: true,
  data: { items: [record], returned_count: 1, matched_count: 3, remaining_count: 2,
    truncated: true, next_cursor: "page-2" },
}
const getPayload = {
  action: "get", id: record.id,
  memory: {
    frontmatter: { ...record, created_at: "2026-09-05T00:00:00Z", updated_at: "2026-09-05T00:00:00Z",
      retrieval: { keywords: ["writer"], entities: ["Jiandu"] } },
    body: "<script>untrusted()</script>", path: "/private/runtime/.jiandu/record.md",
    body_truncated: true, retrieval_metadata_truncated: true,
  },
}
const draft: CreateProjectMemoryInput = { title: record.title, type: "project", content: "One writer." }
const response = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status, headers: { "content-type": "application/json" },
})
const envelope = (payload: unknown, overrides: Record<string, unknown> = {}) => ({
  result: JSON.stringify({ tool_name: "memory", success: true,
    result: JSON.stringify(payload), display_preference: "Default", ...overrides }),
})
const session = (overrides: Record<string, unknown> = {}) => ({ session: {
  id: "root-1", title: "Project conversation", kind: "root", root_session_id: "root-1",
  project_id: "project-1", ...overrides,
} })
const fetchMock = vi.fn<typeof fetch>()
let service: JianduMemoryApi
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  service = new JianduMemoryApi()
})
const reply = (payload: unknown) => fetchMock.mockResolvedValueOnce(response(envelope(payload)))
const posted = () => {
  const [url, init] = fetchMock.mock.calls.at(-1)!
  expect(url).toBe(apiClient.resolveUrl("tools/execute"))
  expect(init?.method).toBe("POST")
  const body = JSON.parse(String(init?.body)) as {
    tool_name: string; session_id: string; parameters: { name: string; value: string }[]
  }
  expect(Object.keys(body).sort()).toEqual(["parameters", "session_id", "tool_name"])
  expect(body.tool_name).toBe("memory")
  expect(body.session_id).toBe(context.authoritySessionId)
  expect(body.parameters.every(({ value }) => typeof value === "string")).toBe(true)
  expect(body.parameters.some(({ name }) => name === "project_key")).toBe(false)
  return Object.fromEntries(body.parameters.map(({ name, value }) => [name, JSON.parse(value)]))
}

describe("server-confirmed Project context", () => {
  it("loads a real root summary before granting a Project context", async () => {
    fetchMock.mockResolvedValueOnce(response(session()))
    await expect(service.resolveProjectContext("root-1")).resolves.toEqual(context)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(apiClient.resolveUrl("sessions/root-1"))
    expect(fetchMock.mock.calls[0][1]?.method).toBe("GET")
  })

  it("resolves a child through the server root id and requires the same Project", async () => {
    fetchMock.mockResolvedValueOnce(response(session({ id: "child-1", kind: "child", title: "Child" })))
      .mockResolvedValueOnce(response(session()))
    await expect(service.resolveProjectContext("child-1")).resolves.toEqual({
      ...context, activeSessionId: "child-1", activeSessionTitle: "Child",
    })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      apiClient.resolveUrl("sessions/child-1"), apiClient.resolveUrl("sessions/root-1"),
    ])
  })

  it.each([
    { project_id: null }, { project_id: "" }, { project_id: 17 },
    { kind: "unknown" }, { root_session_id: "different-root" }, { id: "wrong-id" },
  ])("rejects incomplete or mismatched root summary %j", async (overrides) => {
    fetchMock.mockResolvedValueOnce(response(session(overrides)))
    await expect(service.resolveProjectContext("root-1")).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([null, "different-project"])("rejects child Project mismatch %s", async (projectId) => {
    fetchMock.mockResolvedValueOnce(response(session({ id: "child-1", kind: "child", project_id: projectId })))
      .mockResolvedValueOnce(response(session()))
    await expect(service.resolveProjectContext("child-1")).rejects.toThrow()
  })

  it("does not infer permission from compatibility plan_mode state", async () => {
    fetchMock.mockResolvedValueOnce(response(session({ plan_mode: { phase: "active" } })))
    await expect(service.resolveProjectContext("root-1")).resolves.toEqual(context)
  })

  it("encodes a navigation id and rejects an empty id without any request", async () => {
    await expect(service.resolveProjectContext(" ")).rejects.toMatchObject({ code: "context_unavailable" })
    expect(fetchMock).not.toHaveBeenCalled()
    fetchMock.mockResolvedValueOnce(response(session({ id: "root/1", root_session_id: "root/1" })))
    await service.resolveProjectContext("root/1")
    expect(fetchMock.mock.calls[0][0]).toBe(apiClient.resolveUrl("sessions/root%2F1"))
  })

  it("maps a missing server session to an unavailable context", async () => {
    fetchMock.mockResolvedValueOnce(response({ error: "/private/runtime/session.json" }, 404))
    await expect(service.resolveProjectContext("root-1")).rejects.toMatchObject({
      code: "context_unavailable", message: "context_unavailable",
    })
  })
})

describe("the four fixed native memory operations", () => {
  it("lists compact Project records with honest counts and an opaque cursor", async () => {
    reply(queryPayload)
    await expect(service.queryProjectMemories(context, {
      query: "123", cursor: "page-1", filters: { type: ["project"], status: ["active"] },
    })).resolves.toEqual({
      items: [{ id: record.id, title: record.title, type: "project", status: "active",
        summary: record.summary, tags: ["release"] }],
      returnedCount: 1, matchedCount: 3, remainingCount: 2, truncated: true, nextCursor: "page-2",
    })
    expect(posted()).toEqual({ action: "query", scope: "project", query: "123",
      filters: { type: ["project"], status: ["active"], granularity: [] },
      options: { limit: 20, cursor: "page-1" } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("supports an empty listing without silently falling back to Global", async () => {
    reply({ action: "query", success: true, data: { items: [], returned_count: 0,
      matched_count: 0, remaining_count: 0, truncated: false } })
    await expect(service.queryProjectMemories(context)).resolves.toEqual({
      items: [], returnedCount: 0, matchedCount: 0, remainingCount: 0, truncated: false,
    })
    expect(posted()).toEqual({ action: "query", scope: "project", query: "", options: { limit: 20 } })
  })

  it("fetches only the selected body, preserves truncation, and discards server paths", async () => {
    reply(getPayload)
    const detail = await service.getProjectMemory(context, record.id)
    expect(detail).toMatchObject({ id: record.id, body: getPayload.memory.body,
      bodyTruncated: true, retrievalMetadataTruncated: true, keywords: ["writer"], entities: ["Jiandu"] })
    expect(detail).not.toHaveProperty("path")
    expect(JSON.stringify(detail)).not.toContain("/private/runtime")
    expect(posted()).toEqual({ action: "get", id: record.id, options: { max_chars: 6000 } })
  })

  it("creates once with all strings JSON-encoded and automatic merging disabled", async () => {
    reply({ action: "write", memory: { ...record, title: "123" } })
    await expect(service.createProjectMemory(context, {
      title: " 123 ", type: "project", content: "true", tags: [" true ", "true"],
      keywords: ["false"], entities: ["Jiandu"], granularity: "day",
    })).resolves.toMatchObject({ id: record.id, title: "123", status: "active" })
    expect(posted()).toEqual({ action: "write", scope: "project", type: "project", title: "123",
      content: "true", tags: ["true"], keywords: ["false"], entities: ["Jiandu"],
      granularity: "day", options: { allow_merge_if_similar: false } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("archives exactly one selected id, never a bulk or permanent purge", async () => {
    reply({ action: "purge", id: record.id, status: "archived" })
    await expect(service.archiveProjectMemory(context, record.id)).resolves.toBeUndefined()
    expect(posted()).toEqual({ action: "purge", id: record.id, mode: "archived" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each(["", " ", "x".repeat(129)])("rejects missing or overlong archive id %s", async (id) => {
    await expect(service.archiveProjectMemory(context, id)).rejects.toMatchObject({ code: "invalid_input" })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("nested result and mutation failure boundaries", () => {
  it.each([
    null, { result: 7 }, { result: "not-json" },
    envelope(queryPayload, { tool_name: "another_tool" }),
    envelope(queryPayload, { display_preference: null }),
    envelope(queryPayload, { success: false }),
    envelope(queryPayload, { result: "not-json" }),
    envelope({ ...queryPayload, action: "write" }),
    envelope({ ...queryPayload, success: false }),
    envelope({ ...queryPayload, data: { ...queryPayload.data, items: null } }),
    envelope({ ...queryPayload, data: { ...queryPayload.data, returned_count: 2 } }),
  ])("does not treat HTTP 200 as successful memory access (%#)", async (payload) => {
    fetchMock.mockResolvedValueOnce(response(payload))
    await expect(service.queryProjectMemories(context)).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([{ scope: "global" }, { project_key: "another-project" }])(
    "rejects a record outside the server-confirmed Project %j", async (overrides) => {
      reply({ ...queryPayload, data: { ...queryPayload.data, items: [{ ...record, ...overrides }] } })
      await expect(service.queryProjectMemories(context)).rejects.toMatchObject({ code: "malformed_response" })
    },
  )

  it.each([
    { ...getPayload, id: "other-id" },
    { ...getPayload, memory: { ...getPayload.memory, frontmatter: { ...getPayload.memory.frontmatter, id: "other-id" } } },
    { ...getPayload, memory: { ...getPayload.memory, body_truncated: undefined } },
  ])("rejects mismatched or incomplete selected detail (%#)", async (payload) => {
    reply(payload)
    await expect(service.getProjectMemory(context, record.id)).rejects.toMatchObject({ code: "malformed_response" })
  })

  it.each([{ id: "other-id", status: "archived" }, { id: record.id, status: "deleted" }])(
    "requires the archive receipt to match exactly %j", async (receipt) => {
      reply({ action: "purge", ...receipt })
      await expect(service.archiveProjectMemory(context, record.id)).rejects.toMatchObject({ code: "malformed_response" })
    },
  )

  it.each([{ title: "wrong-title" }, { type: "feedback" }, { status: "archived" }, { scope: "global" }])(
    "rejects an inconsistent create receipt %j", async (overrides) => {
      reply({ action: "write", memory: { ...record, ...overrides } })
      await expect(service.createProjectMemory(context, draft)).rejects.toMatchObject({ code: "malformed_response" })
    },
  )

  for (const operation of ["create", "archive"] as const) {
    it.each(["lost-response", "http-503", "http-403"])(`${operation} never replays after %s`, async (failure) => {
      if (failure === "lost-response") fetchMock.mockRejectedValue(new TypeError("/private/runtime: response lost"))
      else fetchMock.mockImplementation(async () => response({ error: "/private/runtime: failure" }, failure === "http-403" ? 403 : 503))
      const result = operation === "create"
        ? service.createProjectMemory(context, draft)
        : service.archiveProjectMemory(context, record.id)
      await expect(result).rejects.toMatchObject({ code: failure === "http-403" ? "access_denied"
        : failure === "lost-response" ? "request_failed" : "action_rejected" })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  }

  it("keeps tool-rejected errors safe without exposing raw filesystem details", async () => {
    fetchMock.mockResolvedValueOnce(response(envelope("/private/runtime/secret", { success: false })))
    await expect(service.queryProjectMemories(context)).rejects.toMatchObject({
      code: "action_rejected", message: "action_rejected",
    })
  })
})

describe("bounded create and query inputs", () => {
  it.each([{ title: "" }, { content: " " }, { title: "x".repeat(161) },
    { content: "x".repeat(4001) }, { tags: ["x".repeat(65)] },
    { keywords: Array.from({ length: 33 }, (_, index) => String(index)) },
    { entities: Array.from({ length: 17 }, (_, index) => String(index)) },
  ])("rejects invalid create input before dispatch %j", async (overrides) => {
    await expect(service.createProjectMemory(context, { ...draft, ...overrides })).rejects.toMatchObject({ code: "invalid_input" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([{ query: "x".repeat(513) }, { limit: 0 }, { limit: 21 }, { cursor: " " }])(
    "rejects an unbounded or malformed query %j", async (input) => {
      await expect(service.queryProjectMemories(context, input)).rejects.toMatchObject({ code: "invalid_input" })
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it("normalizes metadata and bounds a lexical lookup without sending the full body", () => {
    expect(normalizeCreateProjectMemoryInput({ ...draft, tags: [" writer ", "writer", ""] }).tags).toEqual(["writer"])
    const input = { ...draft, content: "BODY NOT FOR LOOKUP", keywords: ["native"], entities: ["Jiandu"] }
    expect(createLookupQuery(input)).toBe("Release decision native Jiandu")
    expect(createLookupQuery(input)).not.toContain(input.content)
    expect([...createLookupQuery({ ...draft, keywords: Array.from({ length: 20 }, (_, i) => `${i}${"词".repeat(90)}`) })].length).toBeLessThanOrEqual(512)
  })

  it("compares active session, authority root and Project rather than display titles", () => {
    expect(sameJianduProjectContext(context, { ...context, activeSessionTitle: "Renamed" })).toBe(true)
    for (const key of ["activeSessionId", "authoritySessionId", "projectId"] as const) {
      expect(sameJianduProjectContext(context, { ...context, [key]: "changed" })).toBe(false)
    }
  })
})
