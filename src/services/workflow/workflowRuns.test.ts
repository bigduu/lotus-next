import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError, NetworkRequestError } from "../api/errors"
import { prepareWorkflowSelection, type WorkflowCatalogEntry } from "../command/workflowCatalog"
import { parseWorkflowRun, prepareWorkflowRun, workflowRuns, workflowRunError, workflowRunUnavailableReason } from "./workflowRuns"

const client = vi.hoisted(() => ({ get: vi.fn(), postOnce: vi.fn() }))
vi.mock("../api", async () => ({ apiClient: client, ...await import("../api/errors") }))
const entry: WorkflowCatalogEntry = { id: "review/exact", name: "Review", description: "Read selected files", kind: "orchestration",
  source: "user", revision: 7, status: "valid", winner: true, invocation_policy: { explicit: true },
  argument_schema: { type: "object", required: ["file"], properties: { file: { type: "string" } }, additionalProperties: false } }
const raw = (sessionId = "root/id?", runId = "run/id?", sequence = 5) => ({
  run_id: runId, session_id: sessionId, workflow_id: entry.id, workflow_revision: 7, definition_bundle_hash: "hash",
  status: "running", can_cancel: true, can_restart_as_new_run: false, last_sequence: sequence,
  steps: { yes: { id: "yes", status: "succeeded", attempts: 1 }, no: { id: "no", status: "skipped", attempts: 0 } },
  plan: { type: "choice", then_branch: { type: "step", step: "yes" }, else_branch: { type: "step", step: "no" } },
  budget: { max_steps: 8, max_retries: 2, max_agents: 1, wall_time_ms: 30000, max_tokens: 1000 },
  usage: { steps: 1, retries: 0, agents: 0, tokens: 0, cost_micros: 0 }, child_agent_count: 0,
  created_at: "2026-10-08T00:00:00Z", updated_at: "2026-10-08T00:00:01Z",
})
beforeEach(() => { client.get.mockReset(); client.postOnce.mockReset() })

describe("session-scoped Workflow Run client", () => {
  it("starts the exact orchestration revision once and keeps instruction admission separate", async () => {
    client.postOnce.mockResolvedValue(raw())
    const draft = { entry, argsText: '{"file":"src/one.ts"}' }
    expect(prepareWorkflowRun(draft)).toEqual({ workflow_id: entry.id, revision: 7, args: { file: "src/one.ts" } })
    await workflowRuns.start("root/id?", draft)
    expect(client.postOnce).toHaveBeenCalledExactlyOnceWith("sessions/root%2Fid%3F/workflow-runs", {
      workflow_id: entry.id, revision: 7, args: { file: "src/one.ts" },
    })
    expect(() => prepareWorkflowSelection(draft)).toThrow("Workflow Run API")
    const instruction = { ...entry, kind: "instruction" as const }
    expect(prepareWorkflowSelection({ entry: instruction, argsText: draft.argsText })).toEqual({ id: entry.id, source: "user", revision: 7, args: { file: "src/one.ts" } })
    expect(workflowRunUnavailableReason(instruction)).not.toBeNull()
  })
  it.each([
    '{"file":2}', '{}', '{"file":"safe","extra":true}', '{"file":"safe","number":1e400}', 'invalid json',
  ])("validates args before any mutation: %s", async (argsText) => {
    await expect(workflowRuns.start("root", { entry, argsText })).rejects.toThrow()
    expect(client.postOnce).not.toHaveBeenCalled()
  })
  it.each([
    { status: "invalid" }, { winner: false }, { revision: 0 }, { invocation_policy: { explicit: false } },
  ])("does not admit unavailable definitions: %o", async (changes) => {
    await expect(workflowRuns.start("root", { entry: { ...entry, ...changes } as WorkflowCatalogEntry, argsText: '{"file":"safe"}' })).rejects.toThrow()
    expect(client.postOnce).not.toHaveBeenCalled()
  })
  it("uses encoded canonical read routes, since cursor and dedicated single-attempt cancel", async () => {
    const signal = new AbortController().signal
    client.get.mockResolvedValueOnce([raw()]).mockResolvedValueOnce(raw()).mockResolvedValueOnce([
      { run_id: "run/id?", sequence: 6, type: "phase", name: "retry_reserved" },
      { run_id: "run/id?", sequence: 7, type: "run_cancelled" },
    ])
    expect(await workflowRuns.list("root/id?", signal)).toHaveLength(1)
    await workflowRuns.detail("root/id?", "run/id?", signal)
    expect(await workflowRuns.events("root/id?", "run/id?", 5, signal)).toEqual([
      { run_id: "run/id?", sequence: 6, type: "phase", phase: "retry_reserved" },
      { run_id: "run/id?", sequence: 7, type: "run_cancelled" },
    ])
    expect(client.get.mock.calls.map(([path]) => path)).toEqual([
      "sessions/root%2Fid%3F/workflow-runs", "sessions/root%2Fid%3F/workflow-runs/run%2Fid%3F", "sessions/root%2Fid%3F/workflow-runs/run%2Fid%3F/events?since=5",
    ])
    expect(client.get.mock.calls.every(([, options]) => options.signal === signal)).toBe(true)
    client.postOnce.mockResolvedValue({ ...raw(), status: "cancelled", last_sequence: 8 })
    expect((await workflowRuns.cancel("root/id?", "run/id?")).status).toBe("cancelled")
    expect(client.postOnce).toHaveBeenCalledExactlyOnceWith("sessions/root%2Fid%3F/workflow-runs/run%2Fid%3F/cancel", {})
  })
  it("drops private and unused topology fields, preserving Choice skipped steps and unmetered optional limits", () => {
    const sentinel = "PRIVATE_BODY_PATH_TOKEN"
    const snapshot = parseWorkflowRun({ ...raw(), args: sentinel, outputs: sentinel, plan: { type: "future_plan", secret: sentinel },
      failure: { code: "execution_failed", retryable: true, message: sentinel },
      suspension: { type: "tool_running", step_id: sentinel, reason: sentinel },
    }, "root/id?")
    expect(snapshot.steps.map((step) => step.status)).toEqual(["succeeded", "skipped"])
    expect(snapshot.budget.max_cost_micros).toBeNull()
    expect(parseWorkflowRun({ ...raw(), usage: { ...raw().usage, cost_micros: null } }, "root/id?").usage.cost_micros).toBeNull()
    expect(JSON.stringify(snapshot)).not.toContain(sentinel)
  })
  it.each([
    { session_id: "different-session" }, { workflow_revision: 0 }, { status: "unknown" }, { last_sequence: 1.5 },
    { steps: { other: { id: "spoofed", status: "running", attempts: 1 } } }, { failure: { code: "secret", retryable: true } },
  ])("rejects mismatched or malformed snapshots: %o", (changes) => {
    expect(() => parseWorkflowRun({ ...raw(), ...changes }, "root/id?")).toThrow()
  })
  it("does not accept a mutation response for a different revision or requested run", async () => {
    client.postOnce.mockResolvedValue({ ...raw(), workflow_revision: 8 })
    await expect(workflowRuns.start("root/id?", { entry, argsText: '{"file":"safe"}' })).rejects.toThrow()
    client.postOnce.mockResolvedValue(raw("root/id?", "other-run"))
    await expect(workflowRuns.cancel("root/id?", "run/id?")).rejects.toThrow()
  })
  it("rejects duplicate list identities and stale/cross-run events; unknown phase text stays private", async () => {
    client.get.mockResolvedValueOnce([raw(), raw()])
    await expect(workflowRuns.list("root/id?")).rejects.toThrow()
    for (const event of [
      { run_id: "other", sequence: 6, type: "run_started" },
      { run_id: "run/id?", sequence: 5, type: "run_started" },
    ]) {
      client.get.mockResolvedValueOnce([event])
      await expect(workflowRuns.events("root/id?", "run/id?", 5)).rejects.toThrow()
    }
    client.get.mockResolvedValueOnce([{ run_id: "run/id?", sequence: 6, type: "phase", name: "PRIVATE_TOKEN" }])
    expect((await workflowRuns.events("root/id?", "run/id?", 5))[0].phase).toBe("workflow_progressed")
  })
  it("explains an unsupported monetary budget from its safe code without displaying backend diagnostics", () => {
    const error = new ApiError("PRIVATE_MESSAGE", 400, "Bad", JSON.stringify({
      code: "workflow_monetary_budget_unsupported", error: { message: "PRIVATE_MESSAGE" },
    }))
    expect(workflowRunError(error, true)).toContain("不支持金额预算")
    expect(workflowRunError(error, true)).not.toContain("PRIVATE_MESSAGE")
  })
  it("maps a conflict to refresh guidance without claiming a new run is terminal", () => {
    const result = workflowRunError(new ApiError("PRIVATE_CONFLICT", 409, "Conflict"), true)
    expect(result).toContain("编排状态已变化")
    expect(result).not.toContain("此运行已结束")
    expect(result).not.toContain("PRIVATE_CONFLICT")
  })
  it("never automatically replays an ambiguous start or displays raw backend errors", async () => {
    const sentinel = "PRIVATE_TOKEN_PATH_BODY"
    client.postOnce.mockRejectedValue(new NetworkRequestError(new Error(sentinel)))
    await expect(workflowRuns.start("root", { entry, argsText: '{"file":"safe"}' })).rejects.toThrow()
    expect(client.postOnce).toHaveBeenCalledTimes(1)
    expect(workflowRunError(new ApiError(sentinel, 400, "Bad", sentinel), true)).toContain("已保留选择")
    expect(workflowRunError(new Error(sentinel), true)).toContain("尚未确认")
    expect(workflowRunError(new Error(sentinel), true)).not.toContain(sentinel)
  })
})
