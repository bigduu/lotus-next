import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ get: vi.fn() }));
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
});
