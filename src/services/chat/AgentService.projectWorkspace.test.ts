import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkRequestError } from "@services/api/errors";

const api = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("@services/api", () => ({ apiClient: api }));

import { agentClient, type ChatRequest } from "./AgentService";

const request = (overrides: Partial<ChatRequest> = {}): ChatRequest => ({
  message: "Inspect this workspace",
  model: "gpt-5",
  workspace_path: "/workspace/zenith",
  ...overrides,
});

const workspaceConflict = (overrides: Record<string, unknown> = {}): ApiError =>
  new ApiError(
    "Workspace belongs to another Project",
    409,
    "Conflict",
    JSON.stringify({
      error: { code: "project_workspace_conflict" },
      workspace: "/workspace/zenith",
      owner_project_id: "project-zenith",
      session_project_id: "unassigned",
      ...overrides,
    }),
  );

beforeEach(() => {
  api.post.mockReset();
});

describe("new chat Project admission", () => {
  it("retries once with Bamboo's authoritative Workspace owner", async () => {
    const initial = request();
    const acknowledgement = { session_id: "session-1", status: "ok" };
    api.post.mockRejectedValueOnce(workspaceConflict()).mockResolvedValueOnce(acknowledgement);

    await expect(agentClient.sendMessage(initial)).resolves.toEqual(acknowledgement);
    expect(api.post).toHaveBeenNthCalledWith(1, "chat", initial);
    expect(api.post).toHaveBeenNthCalledWith(2, "chat", {
      ...initial,
      project_id: "project-zenith",
    });
    expect(api.post).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["an existing session", request({ session_id: "session-1" })],
    ["an explicit Project", request({ project_id: "project-other" })],
    ["no explicit Workspace", request({ workspace_path: undefined })],
  ])("does not adopt an owner for %s", async (_label, initial) => {
    const error = workspaceConflict();
    api.post.mockRejectedValueOnce(error);

    await expect(agentClient.sendMessage(initial)).rejects.toBe(error);
    expect(api.post).toHaveBeenCalledExactlyOnceWith("chat", initial);
  });

  it.each([
    ["malformed JSON", new ApiError("Conflict", 409, "Conflict", "not-json")],
    ["another HTTP error", new ApiError("Denied", 403, "Forbidden")],
    ["an ambiguous network failure", new NetworkRequestError()],
    [
      "another conflict code",
      workspaceConflict({ error: { code: "session_project_reassignment_required" } }),
    ],
    ["an assigned session receipt", workspaceConflict({ session_project_id: "project-other" })],
    ["a missing owner", workspaceConflict({ owner_project_id: null })],
  ])("does not retry %s", async (_label, error) => {
    const initial = request();
    api.post.mockRejectedValueOnce(error);

    await expect(agentClient.sendMessage(initial)).rejects.toBe(error);
    expect(api.post).toHaveBeenCalledExactlyOnceWith("chat", initial);
  });

  it("propagates a failed owner admission without a third attempt", async () => {
    const retryFailure = new ApiError("Archived", 409, "Conflict");
    api.post.mockRejectedValueOnce(workspaceConflict()).mockRejectedValueOnce(retryFailure);

    await expect(agentClient.sendMessage(request())).rejects.toBe(retryFailure);
    expect(api.post).toHaveBeenCalledTimes(2);
  });
});
