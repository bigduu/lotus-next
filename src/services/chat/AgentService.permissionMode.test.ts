import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkRequestError } from "@services/api/errors";

const raw = vi.hoisted(() => vi.fn());
vi.mock("@services/api", () => ({ apiClient: { fetchRaw: raw } }));

import {
  agentClient,
  parseSessionPermissionMode,
  sessionPermissionRevision,
  SessionPermissionContractError,
  type SessionPermissionMode,
} from "./AgentService";

const response = (mode: unknown, etag: string | null = '"7"', id = "session/a") => new Response(
  JSON.stringify({ session: { id, permission_mode: mode, bypass_permissions: true } }),
  { headers: { "content-type": "application/json", ...(etag ? { ETag: etag } : {}) } },
);

beforeEach(() => { raw.mockReset(); });

describe("typed session permission service", () => {
  it.each(["default", "bypass", "auto"] as const)("reads %s only from the typed detail contract", async (mode) => {
    raw.mockResolvedValue(response(mode));
    await expect(agentClient.getSessionPermissionMode("session/a")).resolves.toEqual({ sessionId: "session/a", mode, etag: '"7"' });
    expect(raw).toHaveBeenCalledExactlyOnceWith("sessions/session%2Fa", { cache: "no-store" });
  });

  it.each([undefined, null, true, "Auto", "future-mode"])("rejects missing or unknown mode %s without Boolean inference", async (mode) => {
    raw.mockResolvedValue(response(mode));
    await expect(agentClient.getSessionPermissionMode("session/a")).rejects.toBeInstanceOf(SessionPermissionContractError);
    expect(parseSessionPermissionMode(mode)).toBeNull();
  });

  it.each([null, "7", '*', 'W/"7"', '"-1"', '"1.5"', '"18446744073709551616"'])("fails closed on an unusable ETag %s", async (etag) => {
    raw.mockResolvedValue(response("auto", etag));
    await expect(agentClient.getSessionPermissionMode("session/a")).rejects.toBeInstanceOf(SessionPermissionContractError);
  });

  it("preserves an exact u64 ETag above JavaScript's safe integer range", async () => {
    const etag = '"18446744073709551614"';
    raw.mockResolvedValue(response("default", etag));
    const snapshot = await agentClient.getSessionPermissionMode("session/a");
    expect(snapshot.etag).toBe(etag);
    expect(sessionPermissionRevision(etag)).toBe(18446744073709551614n);
    raw.mockResolvedValue(response("auto", '"18446744073709551615"'));
    await agentClient.patchSessionPermissionMode("session/a", "auto", snapshot.etag);
    expect(raw.mock.calls[1][1].headers).toEqual({ "If-Match": etag });
  });

  it.each(["default", "bypass", "auto"] as const)("writes only typed %s and the exact If-Match once", async (mode) => {
    raw.mockResolvedValue(response(mode, '"8"'));
    await expect(agentClient.patchSessionPermissionMode("session/a", mode, '"7"')).resolves.toEqual({ sessionId: "session/a", mode, etag: '"8"' });
    expect(raw).toHaveBeenCalledExactlyOnceWith("sessions/session%2Fa", {
      method: "PATCH", headers: { "If-Match": '"7"' },
      body: JSON.stringify({ permission_mode: mode }), cache: "no-store",
    });
  });

  it.each([
    new ApiError("Conflict", 412, "Precondition Failed"),
    new ApiError("Denied", 403, "Forbidden"),
    new NetworkRequestError(),
  ])("propagates a failed or ambiguous write without retrying or falling back", async (error) => {
    raw.mockRejectedValue(error);
    await expect(agentClient.patchSessionPermissionMode("session/a", "auto", '"7"')).rejects.toBe(error);
    expect(raw).toHaveBeenCalledTimes(1);
  });

  it("rejects a success response for the wrong session", async () => {
    raw.mockResolvedValue(response("auto", '"8"', "session/b"));
    await expect(agentClient.patchSessionPermissionMode("session/a", "auto", '"7"')).rejects.toBeInstanceOf(SessionPermissionContractError);
  });

  it("cannot submit unknown modes or invalid preconditions", async () => {
    await expect(agentClient.patchSessionPermissionMode("session/a", "future" as SessionPermissionMode, '"7"')).rejects.toBeInstanceOf(SessionPermissionContractError);
    await expect(agentClient.patchSessionPermissionMode("session/a", "auto", "*")).rejects.toBeInstanceOf(SessionPermissionContractError);
    expect(raw).not.toHaveBeenCalled();
  });
});
