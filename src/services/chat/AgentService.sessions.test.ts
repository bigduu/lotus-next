import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@services/api", () => ({ apiClient: api }));

import { agentClient, type ListSessionsResponse } from "./AgentService";

const emptyPage = (): ListSessionsResponse => ({
  sessions: [],
  total: 0,
  limit: 200,
  offset: 0,
});

beforeEach(() => {
  api.get.mockReset().mockResolvedValue(emptyPage());
  api.post.mockReset();
});

describe("session index transport", () => {
  it("encodes the filtered pagination contract without losing opaque root ids", async () => {
    await agentClient.listSessions({
      limit: 25,
      offset: 50,
      kind: "child",
      root_session_id: "root/a ?",
    });

    expect(api.get).toHaveBeenCalledExactlyOnceWith(
      "sessions?limit=25&offset=50&kind=child&root_session_id=root%2Fa+%3F",
    );
  });

  it("keeps the unfiltered route available for explicit compatibility callers", async () => {
    await expect(agentClient.listSessions()).resolves.toEqual(emptyPage());
    expect(api.get).toHaveBeenCalledExactlyOnceWith("sessions");
  });

  it("encodes a persisted session id for detail-based restore", async () => {
    api.get.mockResolvedValueOnce({ session: { id: "child/a" } });
    await agentClient.getSession("child/a");
    expect(api.get).toHaveBeenCalledExactlyOnceWith("sessions/child%2Fa");
  });

  it("uses message-free mode operations and the same recovery identity", async () => {
    const input = { operationId: "2:550e8400-e29b-41d4-a716-446655440000", birthToken: "a".repeat(64), expectedEpoch: 2, enabled: true };
    await agentClient.selectRootMode("root/a", input);
    await agentClient.recoverRootMode("root/a", input);
    const body = { birth_token: input.birthToken, expected_epoch: 2, enabled: true };
    expect(api.post.mock.calls).toEqual([
      ["sessions/root%2Fa/root-mode-operations/2%3A550e8400-e29b-41d4-a716-446655440000", body],
      ["sessions/root%2Fa/root-mode-operations/2%3A550e8400-e29b-41d4-a716-446655440000/recover", body],
    ]);
  });
});
