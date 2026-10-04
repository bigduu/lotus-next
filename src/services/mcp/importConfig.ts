import { uiText } from "@shared/i18n/ui"
import {
  DEFAULT_HEALTHCHECK_INTERVAL_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_SSE_CONNECT_TIMEOUT_MS,
  DEFAULT_STDIO_STARTUP_TIMEOUT_MS,
  MCP_SERVER_ID_PATTERN,
  type McpImportRequest,
  type McpImportResult,
  type McpServer,
  type TransportConfig,
} from "./types";

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
  if (!text.trim()) return fail(uiText("provide_a_complete_json_configuration_containing_a_mcps_2e2c18b7"));
  if (text.length > MAX_MCP_IMPORT_BYTES || new TextEncoder().encode(text).length > MAX_MCP_IMPORT_BYTES) {
    return fail(uiText("json_configuration_must_be_at_most_1_mib_9939f15a"));
  }
  let root: unknown;
  try { root = JSON.parse(text); } catch { return fail(uiText("invalid_json_check_quotes_commas_and_brackets_error_det_f1e650ac")); }
  if (!isMcpRecord(root) || !only(root, ["mcpServers"]) || !isMcpRecord(root.mcpServers)) {
    return fail(uiText("only_a_complete_mcpservers_server_id_object_is_supporte_afa6183d"));
  }
  const entries = Object.entries(root.mcpServers);
  if (!entries.length) return fail(uiText("mcpservers_cannot_be_empty_import_cannot_clear_all_serv_570ab194"));
  if (entries.length > MAX_SERVERS) return fail(uiText("import_at_most_500_servers_at_a_time_4dd89598"));
  if (has(root.mcpServers, "servers")) return fail(uiText("legacy_servers_lists_are_unsupported_servers_is_a_reser_47c104f7"));
  const servers: McpImportPreviewServer[] = [];
  for (const [index, [id, raw]] of entries.entries()) {
    const invalid = (reason: string) => fail(uiText("entry_82cdfe37", { v0: index + 1, v1: reason }));
    // Unlike form input, map keys cannot be trimmed without changing the target ID.
    if (id !== id.trim() || !MCP_SERVER_ID_PATTERN.test(id)) return invalid(uiText("server_ids_may_contain_only_letters_digits_and_without__ab6bab76"));
    if (!isMcpRecord(raw)) return invalid(uiText("server_configuration_must_be_an_object_8ae12c4c"));
    const internal = has(raw, "transport");
    if (internal && has(raw, "disabled")) return invalid(uiText("use_enabled_for_internal_transport_configuration_the_ba_83e877c7"));
    if (!only(raw, internal ? [...commonKeys, "transport"] : flatKeys)) {
      return invalid(uiText("unsupported_or_mixed_fields_for_http_use_transport_kind_7577394c"));
    }
    if (!validCommon(raw, !internal) || !optional(raw, "disabled", boolean)) return invalid(uiText("invalid_types_for_enabled_state_tool_list_or_timeout_se_c69275c8"));
    const transport = internal ? raw.transport : raw;
    if (!isMcpRecord(transport)) return invalid(uiText("transport_must_be_an_object_1b0b3231"));
    let kind: TransportConfig["type"];
    if (internal) {
      if (transport.type !== "stdio" && transport.type !== "sse" && transport.type !== "streamable_http") return invalid(uiText("unsupported_transport_type_5751fa29"));
      kind = transport.type;
      if (!only(transport, ["type", ...(kind === "stdio" ? stdioKeys : remoteKeys)])) return invalid(uiText("transport_contains_unsupported_fields_379bbbcd"));
    } else {
      const command = raw.command !== undefined && raw.command !== null;
      const url = raw.url !== undefined && raw.url !== null;
      if (command === url) return invalid(uiText("provide_either_command_or_url_not_both_c8e9f37c"));
      if (raw.transport_kind !== undefined && raw.transport_kind !== null &&
        (command || (raw.transport_kind !== "sse" && raw.transport_kind !== "streamable_http"))) return invalid(uiText("transport_kind_supports_only_remote_sse_or_streamable_h_647a07bf"));
      kind = command ? "stdio" : raw.transport_kind === "streamable_http" ? "streamable_http" : "sse";
      if (!only(raw, [...commonKeys, "disabled", ...(kind === "stdio" ? stdioKeys : [...remoteKeys, "transport_kind", "headers_encrypted", "header_credential_refs"])])) {
        return invalid(uiText("do_not_mix_fields_from_different_transport_types_0c9b1f51"));
      }
    }
    if (kind === "stdio") {
      if (typeof transport.command !== "string" || !transport.command.trim() ||
        !optional(transport, "args", strings) || !optional(transport, "cwd", string, true) ||
        !optional(transport, "startup_timeout_ms", integer, !internal)) return invalid(uiText("invalid_stdio_command_arguments_working_directory_or_st_d88fa0a6"));
      for (const key of ["env", "env_encrypted", "env_credential_refs"]) {
        if (!optional(transport, key, stringMap)) return invalid(uiText("environment_variables_and_credential_references_must_be_aa85c455"));
      }
    } else {
      try {
        if (typeof transport.url !== "string" || !["http:", "https:"].includes(new URL(transport.url).protocol)) return invalid(uiText("remote_urls_must_use_http_or_https_290c9d54"));
      } catch { return invalid(uiText("invalid_remote_url_format_161cb180")); }
      if (!optional(transport, "headers", (value) => validHeaders(value, !internal)) ||
        !optional(transport, "connect_timeout_ms", integer, !internal) ||
        !optional(raw, "headers_encrypted", stringMap) || !optional(raw, "header_credential_refs", stringMap)) return invalid(uiText("invalid_headers_or_connection_timeout_header_values_mus_ac9684fd"));
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

const sortedStrings = (values: Iterable<string>) => [...new Set(values)].sort();
const stringKeys = (value: unknown): string[] => isMcpRecord(value) ? Object.keys(value) : [];
const headerNames = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap((header) => isMcpRecord(header) && typeof header.name === "string" ? [header.name] : []);
  }
  return stringKeys(value);
};
const reconnectShape = (value: unknown) => {
  const reconnect = isMcpRecord(value) ? value : {};
  return {
    enabled: typeof reconnect.enabled === "boolean" ? reconnect.enabled : true,
    initial_backoff_ms: typeof reconnect.initial_backoff_ms === "number" ? reconnect.initial_backoff_ms : 1000,
    max_backoff_ms: typeof reconnect.max_backoff_ms === "number" ? reconnect.max_backoff_ms : 30_000,
    max_attempts: typeof reconnect.max_attempts === "number" ? reconnect.max_attempts : 0,
  };
};

function comparableImportedServer(
  raw: Record<string, unknown>,
  preview: McpImportPreviewServer,
) {
  const internal = isMcpRecord(raw.transport);
  const transport = internal ? raw.transport as Record<string, unknown> : raw;
  const common = {
    name: typeof raw.name === "string" ? raw.name : null,
    enabled: preview.enabled,
    request_timeout_ms: typeof raw.request_timeout_ms === "number" ? raw.request_timeout_ms : DEFAULT_REQUEST_TIMEOUT_MS,
    healthcheck_interval_ms: typeof raw.healthcheck_interval_ms === "number" ? raw.healthcheck_interval_ms : DEFAULT_HEALTHCHECK_INTERVAL_MS,
    reconnect: reconnectShape(raw.reconnect),
    allowed_tools: sortedStrings(Array.isArray(raw.allowed_tools) ? raw.allowed_tools.filter(string) : []),
    denied_tools: sortedStrings(Array.isArray(raw.denied_tools) ? raw.denied_tools.filter(string) : []),
  };
  if (preview.transport === "stdio") {
    return { ...common, transport: {
      type: "stdio",
      command: transport.command,
      args: Array.isArray(transport.args) ? transport.args : [],
      cwd: typeof transport.cwd === "string" ? transport.cwd : null,
      env_names: sortedStrings([
        ...stringKeys(transport.env),
        ...stringKeys(transport.env_encrypted),
        // Credential values are intentionally unverifiable, but their names
        // remain safe metadata when the backend exposes them.
        ...stringKeys(transport.env_credential_refs),
      ]),
      startup_timeout_ms: typeof transport.startup_timeout_ms === "number"
        ? transport.startup_timeout_ms
        : DEFAULT_STDIO_STARTUP_TIMEOUT_MS,
    } };
  }
  return { ...common, transport: {
    type: preview.transport,
    url: transport.url,
    header_names: sortedStrings([
      ...headerNames(transport.headers),
      ...stringKeys(raw.headers_encrypted),
      ...stringKeys(raw.header_credential_refs),
    ]),
    connect_timeout_ms: typeof transport.connect_timeout_ms === "number"
      ? transport.connect_timeout_ms
      : DEFAULT_SSE_CONNECT_TIMEOUT_MS,
  } };
}

function comparableActualServer(server: McpServer) {
  const config = server.config;
  const common = {
    name: typeof config.name === "string" ? config.name : null,
    enabled: config.enabled,
    request_timeout_ms: config.request_timeout_ms,
    healthcheck_interval_ms: config.healthcheck_interval_ms,
    reconnect: reconnectShape(config.reconnect),
    allowed_tools: sortedStrings(config.allowed_tools),
    denied_tools: sortedStrings(config.denied_tools),
  };
  if (config.transport.type === "stdio") {
    return { ...common, transport: {
      type: "stdio",
      command: config.transport.command,
      args: config.transport.args,
      cwd: config.transport.cwd ?? null,
      env_names: sortedStrings(Object.keys(config.transport.env)),
      startup_timeout_ms: config.transport.startup_timeout_ms ?? DEFAULT_STDIO_STARTUP_TIMEOUT_MS,
    } };
  }
  return { ...common, transport: {
    type: config.transport.type,
    url: config.transport.url,
    header_names: sortedStrings(config.transport.headers.map((header) => header.name)),
    connect_timeout_ms: config.transport.connect_timeout_ms ?? DEFAULT_SSE_CONNECT_TIMEOUT_MS,
  } };
}

/**
 * Check whether an uncertain import's desired public configuration is already
 * reflected by an authoritative list read. Secret values stay redacted; only
 * their safe key/header names participate in reconciliation.
 */
export function isMcpImportReflected(request: McpImportRequest, current: McpServer[]): boolean {
  let parsed: McpImportValidation;
  try {
    parsed = parseMcpImport(JSON.stringify({ mcpServers: request.mcpServers }));
  } catch {
    return false;
  }
  if (!parsed.ok) return false;
  const incomingIds = parsed.value.servers.map((server) => server.id);
  if (request.mode === "replace" && mcpIdsKey(current.map((server) => server.id)) !== mcpIdsKey(incomingIds)) {
    return false;
  }
  const currentById = new Map(current.map((server) => [server.id, server]));
  return parsed.value.servers.every((preview) => {
    const raw = request.mcpServers[preview.id];
    const actual = currentById.get(preview.id);
    return isMcpRecord(raw) && actual !== undefined &&
      JSON.stringify(comparableImportedServer(raw, preview)) === JSON.stringify(comparableActualServer(actual));
  });
}

export type McpImportFailureKind = "busy" | "rejected" | "uncertain" | "not_applied" | "list_changed" | "list_unavailable";
export class McpImportFailure extends Error {
  constructor(public readonly kind: McpImportFailureKind) {
    super({
      busy: uiText("an_import_is_already_in_progress_wait_for_completion_th_fb46ceab"),
      rejected: uiText("the_server_rejected_the_import_without_committing_confi_32d442f4"),
      uncertain: uiText("the_import_result_cannot_be_confirmed_yet_further_opera_2d04c1a1"),
      not_applied: uiText("the_actual_list_was_checked_automatically_this_configur_99fce191"),
      list_changed: uiText("the_server_list_has_changed_review_the_preview_and_conf_2e03f9bc"),
      list_unavailable: uiText("the_current_server_list_could_not_be_confirmed_refresh__986de92b"),
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
