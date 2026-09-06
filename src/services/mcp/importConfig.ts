import { MCP_SERVER_ID_PATTERN, type McpImportRequest, type McpImportResult, type TransportConfig } from "./types";

export const MAX_MCP_IMPORT_BYTES = 1024 * 1024;
const MAX_SERVERS = 500;
export const isMcpRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const has = (object: Record<string, unknown>, key: string) => Object.hasOwn(object, key);
const only = (object: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(object).every((key) => keys.includes(key));
const string = (value: unknown) => typeof value === "string";
const boolean = (value: unknown) => typeof value === "boolean";
const strings = (value: unknown) => Array.isArray(value) && value.every(string);
const stringMap = (value: unknown) => isMcpRecord(value) && Object.values(value).every(string);
const integer = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const optional = (object: Record<string, unknown>, key: string, valid: (value: unknown) => boolean, nullable = false) =>
  !has(object, key) || (nullable && object[key] === null) || valid(object[key]);
const commonKeys = ["id", "name", "enabled", "request_timeout_ms", "healthcheck_interval_ms", "reconnect", "allowed_tools", "denied_tools"];
const stdioKeys = ["command", "args", "cwd", "env", "env_encrypted", "env_credential_refs", "startup_timeout_ms"];
const remoteKeys = ["url", "headers", "connect_timeout_ms"];
const flatKeys = [...commonKeys, ...stdioKeys, ...remoteKeys, "disabled", "transport_kind", "headers_encrypted", "header_credential_refs"];

function validHeaders(value: unknown, flat: boolean): boolean {
  if (flat && (value === null || stringMap(value))) return true;
  return Array.isArray(value) && value.every((header) => isMcpRecord(header) &&
    only(header, ["name", "value", "value_encrypted", "credential_ref"]) &&
    typeof header.name === "string" && Boolean(header.name.trim()) &&
    optional(header, "value", string) && optional(header, "value_encrypted", string, true) &&
    optional(header, "credential_ref", string, true));
}

function validCommon(entry: Record<string, unknown>, flat: boolean): boolean {
  if (!optional(entry, "name", string, true) || !optional(entry, "enabled", boolean, flat) ||
    !optional(entry, "allowed_tools", strings) || !optional(entry, "denied_tools", strings) ||
    !optional(entry, "request_timeout_ms", integer, flat) ||
    !optional(entry, "healthcheck_interval_ms", integer, flat)) return false;
  if (!has(entry, "reconnect") || (flat && entry.reconnect === null)) return true;
  const reconnect = entry.reconnect;
  return isMcpRecord(reconnect) && only(reconnect, ["enabled", "initial_backoff_ms", "max_backoff_ms", "max_attempts"]) &&
    optional(reconnect, "enabled", boolean) && optional(reconnect, "initial_backoff_ms", integer) &&
    optional(reconnect, "max_backoff_ms", integer) &&
    optional(reconnect, "max_attempts", (value) => integer(value) && (value as number) <= 0xffff_ffff);
}

export interface McpImportPreviewServer {
  id: string;
  transport: TransportConfig["type"];
  enabled: boolean;
}
export interface ParsedMcpImport {
  mcpServers: Record<string, unknown>;
  servers: McpImportPreviewServer[];
}
export type McpImportValidation = { ok: true; value: ParsedMcpImport } | { ok: false; error: string };

/** Mirrors only the supported map shapes. Never returns parser text or secret values. */
export function parseMcpImport(text: string): McpImportValidation {
  const fail = (error: string): McpImportValidation => ({ ok: false, error });
  if (!text.trim()) return fail("请提供包含 mcpServers 对象的完整 JSON 配置。");
  if (text.length > MAX_MCP_IMPORT_BYTES || new TextEncoder().encode(text).length > MAX_MCP_IMPORT_BYTES) {
    return fail("JSON 配置不能超过 1 MiB。");
  }
  let root: unknown;
  try { root = JSON.parse(text); } catch { return fail("JSON 格式无效。请检查引号、逗号和括号；错误详情不会显示配置内容。"); }
  if (!isMcpRecord(root) || !only(root, ["mcpServers"]) || !isMcpRecord(root.mcpServers)) {
    return fail("仅支持完整的 {\"mcpServers\": {\"服务器 ID\": {...}}} 对象。");
  }
  const entries = Object.entries(root.mcpServers);
  if (!entries.length) return fail("mcpServers 不能为空；导入不能用于清空全部服务器。");
  if (entries.length > MAX_SERVERS) return fail("一次最多导入 500 个服务器。");
  if (has(root.mcpServers, "servers")) return fail("不支持 legacy servers 列表，且 servers 是保留的服务器 ID。");
  const servers: McpImportPreviewServer[] = [];
  for (const [index, [id, raw]] of entries.entries()) {
    const invalid = (reason: string) => fail(`第 ${index + 1} 项：${reason}`);
    // Unlike form input, map keys cannot be trimmed without changing the target ID.
    if (id !== id.trim() || !MCP_SERVER_ID_PATTERN.test(id)) return invalid("服务器 ID 只能包含字母、数字、- 和 _，不能包含空白。");
    if (!isMcpRecord(raw)) return invalid("服务器配置必须是对象。");
    const internal = has(raw, "transport");
    if (internal && has(raw, "disabled")) return invalid("内部 transport 配置请使用 enabled；disabled 会被后端忽略。");
    if (!only(raw, internal ? [...commonKeys, "transport"] : flatKeys)) {
      return invalid("包含不支持或混合的字段；HTTP 请使用 transport_kind: \"streamable_http\"，不能使用 type: \"http\"。");
    }
    if (!validCommon(raw, !internal) || !optional(raw, "disabled", boolean)) return invalid("启用状态、工具列表或超时配置类型无效。");
    const transport = internal ? raw.transport : raw;
    if (!isMcpRecord(transport)) return invalid("transport 必须是对象。");
    let kind: TransportConfig["type"];
    if (internal) {
      if (transport.type !== "stdio" && transport.type !== "sse" && transport.type !== "streamable_http") return invalid("不支持此 transport 类型。");
      kind = transport.type;
      if (!only(transport, ["type", ...(kind === "stdio" ? stdioKeys : remoteKeys)])) return invalid("transport 包含不支持的字段。");
    } else {
      const command = raw.command !== undefined && raw.command !== null;
      const url = raw.url !== undefined && raw.url !== null;
      if (command === url) return invalid("必须提供 command 或 url，且不能同时提供两者。");
      if (raw.transport_kind !== undefined && raw.transport_kind !== null &&
        (command || (raw.transport_kind !== "sse" && raw.transport_kind !== "streamable_http"))) return invalid("transport_kind 仅支持远程 sse 或 streamable_http。");
      kind = command ? "stdio" : raw.transport_kind === "streamable_http" ? "streamable_http" : "sse";
      if (!only(raw, [...commonKeys, "disabled", ...(kind === "stdio" ? stdioKeys : [...remoteKeys, "transport_kind", "headers_encrypted", "header_credential_refs"])])) {
        return invalid("不能混合不同传输方式的配置字段。");
      }
    }
    if (kind === "stdio") {
      if (typeof transport.command !== "string" || !transport.command.trim() ||
        !optional(transport, "args", strings) || !optional(transport, "cwd", string, true) ||
        !optional(transport, "startup_timeout_ms", integer, !internal)) return invalid("stdio 命令、参数、工作目录或启动超时无效。");
      for (const key of ["env", "env_encrypted", "env_credential_refs"]) {
        if (!optional(transport, key, stringMap)) return invalid("环境变量及凭据引用必须是字符串映射。");
      }
    } else {
      try {
        if (typeof transport.url !== "string" || !["http:", "https:"].includes(new URL(transport.url).protocol)) return invalid("远程 URL 必须使用 HTTP 或 HTTPS。");
      } catch { return invalid("远程 URL 格式无效。"); }
      if (!optional(transport, "headers", (value) => validHeaders(value, !internal)) ||
        !optional(transport, "connect_timeout_ms", integer, !internal) ||
        !optional(raw, "headers_encrypted", stringMap) || !optional(raw, "header_credential_refs", stringMap)) return invalid("请求头或连接超时无效；请求头值必须是字符串。");
    }
    // Internal enabled defaults true; flat enabled overrides !disabled. Map ID wins.
    servers.push({ id, transport: kind, enabled: typeof raw.enabled === "boolean" ? raw.enabled : internal || !raw.disabled });
  }
  return { ok: true, value: { mcpServers: root.mcpServers, servers } };
}

export const mcpIdsKey = (ids: readonly string[]) => JSON.stringify([...ids].sort());
export function previewMcpImport(incomingIds: string[], existingIds: string[], mode: McpImportRequest["mode"]) {
  const incoming = new Set(incomingIds);
  const existing = new Set(existingIds);
  return {
    added: incomingIds.filter((id) => !existing.has(id)),
    updated: incomingIds.filter((id) => existing.has(id)),
    removed: mode === "replace" ? existingIds.filter((id) => !incoming.has(id)).sort() : [],
  };
}

export type McpImportFailureKind = "busy" | "rejected" | "uncertain" | "list_changed" | "list_unavailable";
export class McpImportFailure extends Error {
  constructor(public readonly kind: McpImportFailureKind) {
    super({
      busy: "已有导入正在进行。请等待完成后刷新列表；没有再次发送导入请求。",
      rejected: "服务器拒绝了导入，未提交配置。请检查配置后重新操作；错误详情已隐藏。",
      uncertain: "导入结果尚未确认，配置可能已更新。请刷新实际列表核对；没有自动重发请求。",
      list_changed: "当前服务器列表已变化。请重新查看预览并确认；尚未发送导入请求。",
      list_unavailable: "无法确认当前服务器列表。请刷新后重新预览；尚未发送导入请求。",
    }[kind]);
    this.name = "McpImportFailure";
  }
}

export function readMcpImportResult(raw: unknown, request: McpImportRequest): McpImportResult {
  const ids = Object.keys(request.mcpServers);
  if (!isMcpRecord(raw) || raw.mode !== request.mode || !integer(raw.added) || !integer(raw.updated) || !integer(raw.removed) ||
    (raw.added as number) + (raw.updated as number) !== ids.length || (request.mode === "merge" && raw.removed !== 0) ||
    !strings(raw.server_ids) || mcpIdsKey(raw.server_ids as string[]) !== mcpIdsKey(ids) ||
    (raw.start_errors !== undefined && (!Array.isArray(raw.start_errors) || raw.start_errors.length > 0))) {
    throw new McpImportFailure("uncertain");
  }
  return { mode: request.mode, added: raw.added as number, updated: raw.updated as number, removed: raw.removed as number, server_ids: ids.sort() };
}
