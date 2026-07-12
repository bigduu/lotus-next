/**
 * Plugin Service
 *
 * Talks to bamboo's `/api/v1/plugins` endpoints. That API lives on an
 * unmerged bamboo branch at the time this was written, so every response is
 * parsed defensively (never trust the raw JSON shape) — mirroring the
 * normalize* pattern in mcp/McpService.ts.
 */
import { agentApiClient } from "../api";
import type {
  InstalledPluginView,
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

export class PluginService {
  async listPlugins(): Promise<InstalledPluginView[]> {
    const response = await agentApiClient.get<PluginListResponse>("plugins");
    return Array.isArray(response?.plugins) ? response.plugins.map(normalizePlugin) : [];
  }

  async installPlugin(source: PluginSourceSpec): Promise<InstalledPluginView> {
    const view = await agentApiClient.post<PluginApiRecord>("plugins/install", { source });
    return normalizePlugin(view ?? {});
  }

  async updatePlugin(id: string, source: PluginSourceSpec): Promise<InstalledPluginView> {
    const view = await agentApiClient.post<PluginApiRecord>(
      `plugins/${encodeURIComponent(id)}/update`,
      { source },
    );
    return normalizePlugin(view ?? {});
  }

  async removePlugin(id: string): Promise<void> {
    await agentApiClient.delete<unknown>(`plugins/${encodeURIComponent(id)}`);
  }
}

export const pluginService = new PluginService();
