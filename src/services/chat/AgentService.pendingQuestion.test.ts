import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkRequestError } from "@services/api/errors";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@services/api", () => ({ apiClient: api }));
import { agentClient } from "./AgentService";

const pending = () => ({
  has_pending_question: true, interaction_kind: "permission", question: "Run sleep?",
  options: ["Approve", "Deny"], allow_custom: false, tool_call_id: "call/a", tool_name: "Bash",
  permission_request: {
    session_id: "session/a", request_id: "call/a", request_generation: " opaque generation ",
    policy_revision: 7, tool_name: "shell", permission_type: "execute", resource: "sleep 2",
    operation_summary: "sleep 2", risk_level: "low", reason_code: "ask", effective_mode: "default",
    bypass_requested: false, auto_approve_requested: false,
    allowed_decisions: ["allow_once", "allow_session", "deny_once"], suggested_matchers: [],
  },
});
const decision = {
  request_id: "call/a", request_generation: " opaque generation ",
  decision: "allow_once" as const, expected_policy_revision: 7,
};
const receipt = () => ({ success: true, replayed: false, receipt: {
  session_id: "session/a", decision: { ...decision, confirm_global: false }, decided_at: "2026-09-09T00:00:00Z",
}, resume: { success: true, auto_resume_status: "started", run_id: "run/a" }, auto_resume_status: "started" });

beforeEach(() => { api.get.mockReset(); api.post.mockReset(); });

describe("canonical pending interaction transport", () => {
  it("preserves typed identity and opaque generation while accepting a resolved tool alias", async () => {
    api.get.mockResolvedValue(pending());
    const result = await agentClient.getPendingQuestion("session/a");
    expect(result).toEqual(pending());
    expect(api.get).toHaveBeenCalledExactlyOnceWith("respond/session%2Fa/pending", { cache: "no-store" });
  });
  it.each(["session_id", "request_id"] as const)("rejects mismatched %s", async (field) => {
    const value = pending(); value.permission_request[field] = "different";
    api.get.mockResolvedValue(value);
    await expect(agentClient.getPendingQuestion("session/a")).rejects.toThrow();
  });
  it.each([Number.MAX_SAFE_INTEGER + 1, -1, 1.5, NaN])("rejects unsafe policy revision %s", async (revision) => {
    const value = pending(); value.permission_request.policy_revision = revision;
    api.get.mockResolvedValue(value);
    await expect(agentClient.getPendingQuestion("session/a")).rejects.toThrow();
  });
  it("propagates read failures without manufacturing absence", async () => {
    const error = new NetworkRequestError(); api.get.mockRejectedValue(error);
    await expect(agentClient.getPendingQuestion("session/a")).rejects.toBe(error);
  });
  it.each([null, {}, { has_pending_question: true, interaction_kind: "permission", permission_request: null }])("rejects malformed pending data", async (value) => {
    api.get.mockResolvedValue(value);
    await expect(agentClient.getPendingQuestion("session/a")).rejects.toThrow();
  });
  it("submits the exact typed choice once and reads the backend's nested resume status", async () => {
    api.post.mockResolvedValue(receipt());
    const result = await agentClient.submitPermissionDecision("session/a", decision);
    expect(api.post).toHaveBeenCalledExactlyOnceWith("sessions/session%2Fa/permission-decisions", decision);
    expect(result.autoResumeStatus).toBe("started");
    expect(result.continuationConfirmed).toBe(true);
  });
  it("accepts matching receipt replay without resume, including an earlier CAS revision", async () => {
    const value = receipt();
    api.post.mockResolvedValue({ success: true, replayed: true, receipt: {
      ...value.receipt, decision: { ...value.receipt.decision, expected_policy_revision: 6 },
    } });
    await expect(agentClient.submitPermissionDecision("session/a", decision)).resolves.toEqual({
      replayed: true, autoResumeStatus: undefined, continuationConfirmed: true,
    });
  });
  it.each(["session", "request", "generation", "decision", "matcher", "global"])("rejects a mismatched %s receipt", async (field) => {
    const value = receipt();
    if (field === "session") value.receipt.session_id = "other";
    if (field === "request") value.receipt.decision.request_id = "other";
    if (field === "generation") value.receipt.decision.request_generation = "other";
    if (field === "decision") Object.assign(value.receipt.decision, { decision: "deny_once" });
    if (field === "global") value.receipt.decision.confirm_global = true;
    if (field === "matcher") Object.assign(value.receipt.decision, { matcher_id: "remembered-grant" });
    api.post.mockResolvedValue(value);
    await expect(agentClient.submitPermissionDecision("session/a", decision)).rejects.toThrow();
  });

  it("distinguishes canonical absence and ordinary clarification from unavailable permission", async () => {
    api.get.mockResolvedValueOnce({ has_pending_question: false, interaction_kind: null });
    await expect(agentClient.getPendingQuestion("session/a")).resolves.toEqual({ has_pending_question: false });
    const question = { has_pending_question: true, interaction_kind: "clarification",
      question: "Which branch?", options: ["main", "dev"], allow_custom: true,
      tool_call_id: "clarify/a", permission_request: null };
    api.get.mockResolvedValueOnce(question);
    await expect(agentClient.getPendingQuestion("session/a")).resolves.toEqual(question);
    api.get.mockResolvedValueOnce({ ...question, interaction_kind: "permission" });
    await expect(agentClient.getPendingQuestion("session/a")).rejects.toThrow();
  });

  it("records an explicit DenyOnce without any remembered grant fields", async () => {
    const denial = { ...decision, decision: "deny_once" as const };
    const value = receipt(); Object.assign(value.receipt.decision, denial);
    api.post.mockResolvedValue(value);
    await expect(agentClient.submitPermissionDecision("session/a", denial)).resolves.toMatchObject({ continuationConfirmed: true });
    expect(api.post).toHaveBeenCalledExactlyOnceWith("sessions/session%2Fa/permission-decisions", denial);
  });

  it.each([
    { resume: undefined, auto_resume_status: undefined },
    { resume: { success: false, auto_resume_status: "started" }, auto_resume_status: "started" },
    { resume: { success: true, auto_resume_status: "started" }, auto_resume_status: "completed" },
    { resume: { success: true, auto_resume_status: "started" }, auto_resume_status: undefined },
    { resume: { success: true, auto_resume_status: "error: session not found" }, auto_resume_status: "error: session not found" },
    { resume: true, auto_resume_status: "started" },
  ])("retains a matching decision receipt when continuation cannot be confirmed: %j", async (continuation) => {
    api.post.mockResolvedValue({ ...receipt(), ...continuation });
    await expect(agentClient.submitPermissionDecision("session/a", decision)).resolves.toMatchObject({
      replayed: false, continuationConfirmed: false,
    });
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it.each(["already_running", "completed"])("recognizes the backend continuation status %s", async (status) => {
    api.post.mockResolvedValue({ ...receipt(), resume: { success: true, auto_resume_status: status }, auto_resume_status: status });
    await expect(agentClient.submitPermissionDecision("session/a", decision)).resolves.toMatchObject({
      autoResumeStatus: status, continuationConfirmed: true,
    });
  });

  it.each([-1, 1.5, "7", {}, Number.MAX_SAFE_INTEGER + 1])("rejects malformed receipt policy revision %j without treating it as a CAS conflict", async (revision) => {
    const value = receipt(); Object.assign(value.receipt.decision, { expected_policy_revision: revision });
    api.post.mockResolvedValue(value);
    await expect(agentClient.submitPermissionDecision("session/a", decision)).rejects.toThrow();
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it.each([null, undefined, 6])("accepts an optional or older receipt CAS revision %s", async (revision) => {
    const value = receipt(); Object.assign(value.receipt.decision, { expected_policy_revision: revision });
    api.post.mockResolvedValue({ ...value, replayed: true });
    await expect(agentClient.submitPermissionDecision("session/a", decision)).resolves.toMatchObject({
      replayed: true, continuationConfirmed: true,
    });
  });
  it.each([new ApiError("stale", 409, "Conflict"), new NetworkRequestError()])("does not retry ambiguous writes or fall back to text", async (error) => {
    api.post.mockRejectedValue(error);
    await expect(agentClient.submitPermissionDecision("session/a", decision)).rejects.toBe(error);
    expect(api.post).toHaveBeenCalledTimes(1);
  });
});
