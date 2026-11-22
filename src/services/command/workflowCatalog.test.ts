import { beforeEach, describe, expect, it, vi } from "vitest"
import { getWorkflowCatalog, parseWorkflowCatalog, parseWorkflowArguments, type WorkflowCatalogEntry } from "./workflowCatalog"

const get = vi.hoisted(() => vi.fn())
vi.mock("../api", () => ({ apiClient: { get } }))
const entry: WorkflowCatalogEntry = {
  id: "review/id", name: "Review", description: "Review a bounded change", kind: "orchestration",
  source: "project", revision: 7, status: "valid", winner: true,
  invocation_policy: { explicit: true }, argument_schema: { type: "object", required: ["target"], properties: {
    target: { type: "string" }, count: { type: "integer", minimum: 1, maximum: 3 },
  }, additionalProperties: false },
}
beforeEach(() => get.mockReset())
describe("Workflow Run catalog and argument validation", () => {
  it("requests only executable definitions with encoded Session authority", async () => {
    get.mockResolvedValue({ revision: 8, entries: [entry] })
    const signal = new AbortController().signal
    expect(await getWorkflowCatalog("root/id?", signal)).toEqual({ revision: 8, entries: [entry] })
    expect(get).toHaveBeenCalledWith("/bamboo/workflow-catalog?orchestration_only=true&session_id=root%2Fid%3F", { signal })
  })
  it.each([
    { source: "global" }, { revision: 1.5 }, { revision: Number.MAX_SAFE_INTEGER + 1 }, { revision: -1 },
    { winner: null }, { invocation_policy: { explicit: "true" } }, { argument_schema: { pattern: "x" } },
  ])("rejects malformed or unsupported metadata: %j", (patch) => {
    expect(() => parseWorkflowCatalog({ revision: 1, entries: [{ ...entry, ...patch }] })).toThrow()
  })
  it.each(['{', '{}', '{"target":3}', '{"target":"src","extra":1}', '{"target":"src","count":1.5}', '{"target":"src","count":4}'])("validates arguments before submission: %s", (argsText) => {
    expect(() => parseWorkflowArguments(entry, argsText)).toThrow()
  })
  it("matches supported arrays, unions, enum object equality and secret capability handles", () => {
    const candidate = { ...entry, argument_schema: { type: "array", items: { type: ["object", "null"], enum: [{ b: 2, a: 1 }, null] } } }
    expect(parseWorkflowArguments(candidate, '[{"a":1,"b":2},null]')).toEqual([{ a: 1, b: 2 }, null])
    const secret = { ...entry, argument_schema: { "x-bamboo-secret": true } }
    expect(() => parseWorkflowArguments(secret, '"raw-value"')).toThrow()
    expect(parseWorkflowArguments(secret, '{"$secret":"capability"}')).toEqual({ $secret: "capability" })
  })
  it("checks own properties for special JSON keys", () => {
    const candidate = { ...entry, argument_schema: JSON.parse('{"type":"object","required":["constructor","__proto__"],"properties":{"constructor":{"type":"string"},"__proto__":{"type":"string"}},"additionalProperties":false}') }
    expect(() => parseWorkflowArguments(candidate, '{}')).toThrow()
    expect(parseWorkflowArguments(candidate, '{"constructor":"c","__proto__":"p"}')).toEqual(JSON.parse('{"constructor":"c","__proto__":"p"}'))
  })
  it.each(['1e400', '9007199254740993', '{"nested":[1e400]}'])("rejects lossy JSON numeric arguments even with an empty schema: %s", (argsText) => {
    expect(() => parseWorkflowArguments({ ...entry, argument_schema: {} }, argsText)).toThrow("数值必须有限")
  })
})
