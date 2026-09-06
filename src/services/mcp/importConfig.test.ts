import { describe, expect, it } from "vitest";
import { MAX_MCP_IMPORT_BYTES, McpImportFailure, mcpIdsKey, parseMcpImport, previewMcpImport, readMcpImportResult } from "./importConfig";

const json = (mcpServers: unknown) => JSON.stringify({ mcpServers });
const secret = "IMPORT_SECRET_MUST_NOT_APPEAR";
const stdio = { command: "fixture-mcp", args: ["--stdio"], env: { TOKEN: secret } };

describe("MCP JSON import validation and safe preview", () => {
  it("preserves flat/internal stdio, SSE and HTTP entries with their actual enabled semantics", () => {
    const servers = {
      flat: { ...stdio, id: "ignored-id", disabled: true, enabled: true },
      disabled: { url: "https://example.test/sse", headers: { Authorization: secret }, disabled: true },
      http: { url: "https://example.test/mcp", transport_kind: "streamable_http", enabled: false },
      internal: { transport: { type: "streamable_http", url: "https://example.test/mcp", headers: [{ name: "Authorization", value: secret }] } },
      internalStdio: { enabled: false, transport: { type: "stdio", command: "fixture-mcp", args: [], env: { TOKEN: secret } } },
      internalSse: { enabled: true, transport: { type: "sse", url: "http://localhost/sse", headers: [] } },
    };
    const parsed = parseMcpImport(json(servers));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.mcpServers).toEqual(servers);
    expect(parsed.value.servers).toEqual([
      { id: "flat", transport: "stdio", enabled: true }, { id: "disabled", transport: "sse", enabled: false },
      { id: "http", transport: "streamable_http", enabled: false }, { id: "internal", transport: "streamable_http", enabled: true },
      { id: "internalStdio", transport: "stdio", enabled: false }, { id: "internalSse", transport: "sse", enabled: true },
    ]);
    expect(JSON.stringify(parsed.value.servers)).not.toContain(secret);
  });

  it.each(["", "null", "[]", "{", `{"mcpServers": {"x": "${secret}"}`, "{}", json({}), json([]), json(null),
    JSON.stringify({ mcpServers: { one: stdio }, unrelated: true }), json({ servers: [] }), json({ " ": stdio }), json({ x: null }),
  ])("rejects empty/invalid/unsupported root shapes without parser details: %s", (value) => {
    const result = parseMcpImport(value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toContain(secret);
  });

  it.each(["scope/server", "x?y", "x#y", ".", "..", "scope/../server", "../../sessions/session-fixture", "encoded%2Fid", "%3Fquery", "%23hash",
    " leading", "trailing ", "white space", "tab\tid", "line\nid", "trailing\n", "\t", "",
  ])("rejects IDs outside the existing form contract without echoing their contents", (id) => {
    expect(parseMcpImport(json({ [id]: stdio }))).toEqual({
      ok: false, error: "第 1 项：服务器 ID 只能包含字母、数字、- 和 _，不能包含空白。",
    });
  });

  it("accepts letters, digits, hyphens and underscores as exact map IDs", () => {
    const mcpServers = { "Abc-09_XYZ": stdio, "_": stdio, "-": stdio, "9": stdio };
    const result = parseMcpImport(json(mcpServers));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mcpServers).toEqual(mcpServers);
      expect(result.value.servers.map((server) => server.id)).toEqual(Object.keys(mcpServers));
    }
  });

  it.each([
    { type: "http", url: "https://example.test/mcp" }, { transport: "sse", url: "https://example.test/sse" },
    { transport: { type: "streamablehttp", url: "https://example.test/mcp" } },
    { transport: { type: "sse", url: "https://example.test/sse" }, disabled: true },
    { ...stdio, url: "https://example.test/sse" }, { ...stdio, headers: { Authorization: secret } },
    { command: "" }, { command: "fixture", args: [4] }, { command: "fixture", env: { TOKEN: 4 } },
    { command: "fixture", startup_timeout_ms: -1 }, { command: "fixture", request_timeout_ms: Number.MAX_SAFE_INTEGER + 1 },
    { command: "fixture", reconnect: { max_attempts: 0x1_0000_0000 } },
    { url: "not a URL" }, { url: "file:///tmp/server" }, { url: "https://example.test", transport_kind: "http" },
    { url: "https://example.test", headers: { Authorization: 4 } }, { url: "https://example.test", headers: [{ name: "Authorization", value: 4 }] },
    { transport: { type: "sse", url: "https://example.test", headers: { Authorization: secret } } },
    { ...stdio, enabled: "false" }, { ...stdio, unknownField: secret },
  ])("rejects ambiguous or incorrectly typed server configuration before mutation", (entry) => {
    const result = parseMcpImport(json({ test: entry }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toContain(secret);
  });

  it("bounds file/text and server count without parsing oversized content", () => {
    expect(parseMcpImport(" ".repeat(MAX_MCP_IMPORT_BYTES + 1)).ok).toBe(false);
    expect(parseMcpImport(json(Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`s${i}`, stdio])))).ok).toBe(false);
  });

  it("previews whole-entry upsert by map ID and only Replace removes omitted IDs", () => {
    expect(previewMcpImport(["new", "existing"], ["keep", "existing"], "merge")).toEqual({ added: ["new"], updated: ["existing"], removed: [] });
    expect(previewMcpImport(["new", "existing"], ["keep", "existing"], "replace")).toEqual({ added: ["new"], updated: ["existing"], removed: ["keep"] });
    expect(mcpIdsKey(["b", "a"])).toBe(mcpIdsKey(["a", "b"]));
  });

  it("returns only validated authoritative counts and IDs, never response messages", () => {
    const result = readMcpImportResult({ mode: "merge", added: 1, updated: 0, removed: 0, server_ids: ["x"], message: secret, start_errors: [] }, { mode: "merge", mcpServers: { x: stdio } });
    expect(result).toEqual({ mode: "merge", added: 1, updated: 0, removed: 0, server_ids: ["x"] });
  });

  it.each([null, { added: -1 }, { added: 0.5 }, { updated: 2 }, { removed: 1 }, { server_ids: [secret] },
    { server_ids: ["x", "x"] }, { mode: "replace" }, { start_errors: [{ server_id: "x", error: secret }] },
  ])("treats malformed/partial success as uncertain without exposing secrets", (overrides) => {
    const response = overrides === null ? null : { mode: "merge", added: 1, updated: 0, removed: 0, server_ids: ["x"], ...overrides };
    expect(() => readMcpImportResult(response, { mode: "merge", mcpServers: { x: stdio } })).toThrow(McpImportFailure);
    try { readMcpImportResult(response, { mode: "merge", mcpServers: { x: stdio } }); } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});
