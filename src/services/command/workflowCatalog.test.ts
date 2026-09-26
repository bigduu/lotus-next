import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "../api/errors"
import { getWorkflowCatalog, parseWorkflowCatalog, prepareWorkflowSelection, workflowSubmissionError, workflowUnavailableReason, type WorkflowCatalogEntry } from "./workflowCatalog"

const get = vi.hoisted(() => vi.fn())
vi.mock("../api", () => ({ apiClient: { get } }))
export const entry: WorkflowCatalogEntry = {
  id: "review/id", name: "Review", description: "Review a bounded change", kind: "instruction",
  source: "project", revision: 7, status: "valid", winner: true,
  invocation_policy: { explicit: true }, argument_schema: { type: "object", required: ["target"], properties: {
    target: { type: "string" }, count: { type: "integer", minimum: 1, maximum: 3 },
  }, additionalProperties: false },
}
beforeEach(() => get.mockReset())
describe("canonical Workflow catalog and exact typed selection", () => {
  it("uses the authenticated API client and Session authority, including encoded identity", async () => {
    get.mockResolvedValue({ revision: 8, entries: [entry] })
    const signal = new AbortController().signal
    expect(await getWorkflowCatalog("root/id?", signal)).toEqual({ revision: 8, entries: [entry] })
    expect(get).toHaveBeenCalledWith("/bamboo/workflow-catalog?session_id=root%2Fid%3F", { signal })
    await getWorkflowCatalog(null)
    expect(get).toHaveBeenLastCalledWith("/bamboo/workflow-catalog", { signal: undefined })
  })
  it("keeps exact identity, source and entry revision rather than the catalog revision or command name", () => {
    const catalog = parseWorkflowCatalog({ revision: 100, entries: [entry] })
    expect(prepareWorkflowSelection({ entry: catalog.entries[0], argsText: '{"target":"src","count":2}' })).toEqual({
      id: "review/id", source: "project", revision: 7, args: { target: "src", count: 2 },
    })
  })
  it.each([
    { source: "global" }, { revision: 1.5 }, { revision: Number.MAX_SAFE_INTEGER + 1 }, { revision: -1 },
    { winner: null }, { invocation_policy: { explicit: "true" } }, { argument_schema: { pattern: "x" } },
  ])("rejects malformed or unsupported metadata: %j", (patch) => {
    expect(() => parseWorkflowCatalog({ revision: 1, entries: [{ ...entry, ...patch }] })).toThrow()
  })
  it.each([
    { revision: 0 }, { status: "invalid" }, { winner: false }, { kind: "orchestration" }, { invocation_policy: { explicit: false } },
  ])("does not submit unavailable catalog entries: %j", (patch) => {
    const candidate = { ...entry, ...patch } as WorkflowCatalogEntry
    expect(workflowUnavailableReason(candidate)).toBeTruthy()
    expect(() => prepareWorkflowSelection({ entry: candidate, argsText: '{"target":"src"}' })).toThrow()
  })
  it.each(['{', '{}', '{"target":3}', '{"target":"src","extra":1}', '{"target":"src","count":1.5}', '{"target":"src","count":4}'])("validates arguments before submission: %s", (argsText) => {
    expect(() => prepareWorkflowSelection({ entry, argsText })).toThrow()
  })
  it("matches supported arrays, unions, enum object equality and secret capability handles", () => {
    const candidate = { ...entry, argument_schema: { type: "array", items: { type: ["object", "null"], enum: [{ b: 2, a: 1 }, null] } } }
    expect(prepareWorkflowSelection({ entry: candidate, argsText: '[{"a":1,"b":2},null]' }).args).toEqual([{ a: 1, b: 2 }, null])
    const secret = { ...entry, argument_schema: { "x-bamboo-secret": true } }
    expect(() => prepareWorkflowSelection({ entry: secret, argsText: '"raw-value"' })).toThrow()
    expect(prepareWorkflowSelection({ entry: secret, argsText: '{"$secret":"capability"}' }).args).toEqual({ $secret: "capability" })
  })
  it("checks own properties for special JSON keys", () => {
    const candidate = { ...entry, argument_schema: JSON.parse('{"type":"object","required":["constructor","__proto__"],"properties":{"constructor":{"type":"string"},"__proto__":{"type":"string"}},"additionalProperties":false}') }
    expect(() => prepareWorkflowSelection({ entry: candidate, argsText: '{}' })).toThrow()
    expect(prepareWorkflowSelection({ entry: candidate, argsText: '{"constructor":"c","__proto__":"p"}' }).args).toEqual(JSON.parse('{"constructor":"c","__proto__":"p"}'))
  })
  it.each(['1e400', '9007199254740993', '{"nested":[1e400]}'])("rejects lossy JSON numeric arguments even with an empty schema: %s", (argsText) => {
    expect(() => prepareWorkflowSelection({ entry: { ...entry, argument_schema: {} }, argsText })).toThrow("数值必须有限")
  })
  it("preserves Bamboo typed diagnostics without classifying transport failure as rejection", () => {
    const error = new ApiError("changed", 409, "Conflict", JSON.stringify({ error: { code: "workflow_revision_mismatch", message: "revision changed" } }))
    expect(workflowSubmissionError(error)).toEqual({ code: "workflow_revision_mismatch", message: "revision changed" })
    expect(workflowSubmissionError(new Error("timeout"))).toBeNull()
    expect(workflowSubmissionError(new ApiError("bad", 400, "Bad", "not json"))).toBeNull()
  })
})
