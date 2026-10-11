/**
 * Plugin Service
 *
 * Talks to bamboo's `/api/v1/plugins` endpoints. Every response is
 * parsed defensively (never trust the raw JSON shape), mirroring the
 * normalize* pattern in mcp/McpService.ts.
 */
import { apiClient } from "../api";
import type {
  InstalledPluginView,
  JianduSetupReport,
  PluginApiRecord,
  PluginListResponse,
  PluginSourceSpec,
  PluginStatus,
  RegisteredResources,
} from "./types";

const parseStatus = (value: unknown): PluginStatus => {
  return value === "installing" ? "installing" : "installed";
};

const normalizeStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const filtered = value.filter((item): item is string => typeof item === "string");
  return filtered.length > 0 ? filtered : undefined;
};

/** Sub-arrays are omitted (not empty-array) by the backend when unused — keep that contract. */
const normalizeRegistered = (value: unknown): RegisteredResources => {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  const registered: RegisteredResources = {};
  const mcpServerIds = normalizeStringArray(record.mcp_server_ids);
  const presetIds = normalizeStringArray(record.preset_ids);
  const skillDirs = normalizeStringArray(record.skill_dirs);
  const workflowFilenames = normalizeStringArray(record.workflow_filenames);
  if (mcpServerIds) registered.mcp_server_ids = mcpServerIds;
  if (presetIds) registered.preset_ids = presetIds;
  if (skillDirs) registered.skill_dirs = skillDirs;
  if (workflowFilenames) registered.workflow_filenames = workflowFilenames;
  return registered;
};

const normalizeSource = (value: unknown): PluginSourceSpec => {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.type === "local_dir" && typeof record.path === "string") {
      return { type: "local_dir", path: record.path };
    }
    if (record.type === "local_archive" && typeof record.path === "string") {
      return { type: "local_archive", path: record.path };
    }
    if (record.type === "url" && typeof record.url === "string") {
      return {
        type: "url",
        url: record.url,
        sha256: typeof record.sha256 === "string" ? record.sha256 : undefined,
      };
    }
  }
  // Malformed/missing source — fall back rather than throw so the list still renders.
  return { type: "local_dir", path: "" };
};

const normalizePlugin = (record: PluginApiRecord): InstalledPluginView => ({
  id: typeof record.id === "string" ? record.id : "",
  name: typeof record.name === "string" ? record.name : undefined,
  version: typeof record.version === "string" ? record.version : "",
  source: normalizeSource(record.source),
  status: parseStatus(record.status),
  registered: normalizeRegistered(record.registered),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const nullableString = (value: unknown) => value === null || typeof value === "string";
const nonemptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const absoluteHostPath = (value: unknown, os: string): value is string =>
  nonemptyString(value) && !value.includes("\0") && !value.includes("\r") && !value.includes("\n") &&
  (os === "windows" ? /^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/.test(value) : value.startsWith("/"));

const parseJianduSetup = (value: unknown): JianduSetupReport => {
  const invalid = () => { throw new Error("Jiandu setup could not be verified."); };
  if (!isRecord(value) || value.plugin_id !== "jiandu") return invalid();
  const { host, release, trust, install, installed, external_client: client } = value;
  if (!isRecord(host) || !nonemptyString(host.os) || !nonemptyString(host.arch) ||
    !nullableString(host.libc) || typeof host.supported !== "boolean" || !nullableString(host.reason) ||
    !isRecord(trust) || typeof trust.trusted !== "boolean" || !nullableString(trust.reason) ||
    !isRecord(install) || typeof install.available !== "boolean" || !nullableString(install.reason) ||
    !isRecord(installed) || typeof installed.state !== "string" || !["missing", "installing", "ready", "unverified"].includes(installed.state) ||
    !nullableString(installed.version) || !nullableString(installed.reason)) return invalid();
  if (release !== null && (!isRecord(release) || !nonemptyString(release.version) ||
    !nonemptyString(release.manifest_url) || typeof release.sha256 !== "string" || !/^[a-f\d]{64}$/i.test(release.sha256))) return invalid();
  if (client !== null && (!isRecord(client) || !absoluteHostPath(client.command, host.os) ||
    !Array.isArray(client.args) || client.args.length !== 2 || client.args[0] !== "--data-dir" ||
    !absoluteHostPath(client.args[1], host.os))) return invalid();
  const eligible = host.supported && trust.trusted && release !== null;
  if (install.available && (!eligible || installed.state !== "missing")) return invalid();
  if ((installed.state === "ready") !== (client !== null) ||
    (installed.state === "ready" && (!eligible || installed.version !== (release as Record<string, unknown>).version))) return invalid();
  // Export only the reviewed command/args fields; never pass through optional
  // transport settings or arbitrary extra wire keys into another MCP client.
  return { ...value, external_client: client === null ? null : {
    command: (client as Record<string, unknown>).command,
    args: (client as Record<string, unknown>).args,
  } } as unknown as JianduSetupReport;
};

export class PluginService {
  async getJianduSetup(): Promise<JianduSetupReport> {
    return parseJianduSetup(await apiClient.get<unknown>("plugins/jiandu/setup"));
  }

  async installOfficialJiandu(): Promise<void> {
    // The source-fixed installer returns InstalledPluginView (201), not setup.
    // Only a subsequent fresh setup GET can authorize external-client copying.
    await apiClient.post<unknown>("plugins/official/jiandu/install", {});
  }

  async listPlugins(): Promise<InstalledPluginView[]> {
    const response = await apiClient.get<PluginListResponse>("plugins");
    const ids = new Set<string>();
    if (!Array.isArray(response?.plugins) || !response.plugins.every((plugin) => {
      if (!plugin || typeof plugin.id !== "string" || !plugin.id.trim() || ids.has(plugin.id) ||
        (plugin.status !== "installed" && plugin.status !== "installing")) return false;
      ids.add(plugin.id);
      return true;
    })) throw new Error("Plugin inventory could not be verified.");
    return response.plugins.map(normalizePlugin);
  }

  async installPlugin(source: PluginSourceSpec): Promise<InstalledPluginView> {
    const view = await apiClient.post<PluginApiRecord>("plugins/install", { source });
    return normalizePlugin(view ?? {});
  }

  async updatePlugin(id: string, source: PluginSourceSpec): Promise<InstalledPluginView> {
    const view = await apiClient.post<PluginApiRecord>(
      `plugins/${encodeURIComponent(id)}/update`,
      { source },
    );
    return normalizePlugin(view ?? {});
  }

  async removePlugin(id: string): Promise<void> {
    await apiClient.delete<unknown>(`plugins/${encodeURIComponent(id)}`);
  }
}

export const pluginService = new PluginService();
