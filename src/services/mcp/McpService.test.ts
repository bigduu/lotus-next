import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient, ApiError, NetworkRequestError } from "../api";
import { McpService } from "./McpService";
import { McpImportFailure } from "./importConfig";

const record = (type = "streamablehttp", id = "remote") => ({ id, enabled: false, status: "stopped", config: {
  id, enabled: false, transport: type === "stdio" ? { type, command: "fixture", args: [], env: { TOKEN: "****...****" } }
    : { type, url: "https://example.test/mcp", headers: [{ name: "Authorization", value: "****...****" }], connect_timeout_ms: 1234 },
} });
const request = { mode: "merge" as const, mcpServers: { incoming: { command: "fixture", disabled: true } } };
const result = { message: "ignored", mode: "merge", added: 1, updated: 0, removed: 0, server_ids: ["incoming"] };
const get = vi.fn(); const post = vi.fn(); const put = vi.fn();
beforeEach(() => {
  get.mockReset(); post.mockReset(); put.mockReset().mockResolvedValue(undefined);
  vi.spyOn(apiClient, "get").mockImplementation(get);
  vi.spyOn(apiClient, "post").mockImplementation(post);
  vi.spyOn(apiClient, "put").mockImplementation(put);
});

describe("McpService import/list contract", () => {
  it.each(["streamablehttp", "streamable_http", "sse", "stdio"])("preserves %s transport through normalized list and edit payload", async (type) => {
    const service = new McpService(); get.mockResolvedValue({ servers: [record(type)] });
    const [server] = await service.getServers();
    const expected = type.startsWith("streamable") ? "streamable_http" : type;
    expect(server.config.transport.type).toBe(expected);
    if (server.config.transport.type !== "stdio") expect(server.config.transport).toMatchObject({ url: "https://example.test/mcp", connect_timeout_ms: 1234, headers: [{ name: "Authorization", value: "****...****" }] });
    await service.updateServer(server.id, server.config);
    expect(put).toHaveBeenCalledExactlyOnceWith("mcp/servers/remote", expect.objectContaining({ transport: expect.objectContaining({ type: expected }) }));
  });

  it.each([{}, { servers: null }, { servers: {} }, { servers: [null] }, { servers: [{ id: "x" }] },
    { servers: [record("http")] }, { servers: [record("sse", " ")] }, { servers: [record(), record()] },
    { servers: [{ ...record(), config: { id: "different", transport: record().config.transport } }] },
    { servers: [{ ...record(), config: { transport: { type: "sse", url: "https://example.test", headers: {} } } }] },
  ])("fails closed on malformed inventory rather than returning an empty/destructive preview", async (response) => {
    get.mockResolvedValue(response);
    await expect(new McpService().getServers()).rejects.toThrow("could not be verified");
    expect(post).not.toHaveBeenCalled();
  });

  it("accepts a verified empty inventory", async () => {
    get.mockResolvedValue({ servers: [] });
    await expect(new McpService().getServers()).resolves.toEqual([]);
  });

  it("sends one canonical POST and synchronously fences another dialog until it settles", async () => {
    let resolve!: (value: unknown) => void;
    post.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const service = new McpService(); const first = service.importServers(request);
    await expect(service.importServers(request)).rejects.toMatchObject({ kind: "busy" });
    expect(post).toHaveBeenCalledExactlyOnceWith("mcp/servers/import", request);
    resolve(result); await expect(first).resolves.toMatchObject({ added: 1, server_ids: ["incoming"] });
    post.mockResolvedValueOnce(result); await service.importServers(request);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it.each([new ApiError("SECRET_BACKEND_DETAIL", 400, "Bad Request", "SECRET_BODY"), new NetworkRequestError(),
    new ApiError("SECRET_BACKEND_DETAIL", 503, "Unavailable", "SECRET_BODY")])("never retries or exposes raw import failures", async (failure) => {
    post.mockRejectedValueOnce(failure);
    const service = new McpService();
    const error = await service.importServers(request).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(McpImportFailure);
    expect(String(error)).not.toContain("SECRET");
    expect(error).toMatchObject({ kind: failure instanceof ApiError && failure.status === 400 ? "rejected" : "uncertain" });
    expect(post).toHaveBeenCalledTimes(1);
  });
});
