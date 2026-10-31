/**
 * Plugin Service
 *
 * Talks to bamboo's `/api/v1/plugins` endpoints. Every response is
 * parsed defensively (never trust the raw JSON shape), mirroring the
 * normalize* pattern in mcp/McpService.ts.
 */
import { apiClient, isApiError } from "../api";
import type {
  InstalledPluginView,
  JianduSetupReport,
  NovaAppSetupReport,
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

const parseNovaAppSetup = (value: unknown): NovaAppSetupReport => {
  const invalid = () => { throw new Error("Nova app setup could not be verified."); };
  if (!isRecord(value) || value.plugin_id !== "nova") return invalid();
  const { host, connector, capability, app, install, artifact, desktop_server_id: desktopId } = value;
  if (!isRecord(host) || !nonemptyString(host.os) || !nonemptyString(host.arch) ||
    typeof host.supported !== "boolean" || !nullableString(host.reason) ||
    !isRecord(connector) || typeof connector.state !== "string" || !["missing", "installing", "unverified", "verified"].includes(connector.state) ||
    !nullableString(connector.version) || !nullableString(connector.reason) ||
    !isRecord(capability) || typeof capability.supported !== "boolean" || !nullableString(capability.reason) ||
    !isRecord(install) || typeof install.available !== "boolean" || !nullableString(install.reason) ||
    !nonemptyString(value.manual_guidance) || value.desktop_readiness !== "not_tested" ||
    (desktopId !== null && (typeof desktopId !== "string" || !/^[a-zA-Z0-9_-]+$/.test(desktopId) || connector.state !== "verified"))) return invalid();
  if (artifact !== null && (!isRecord(artifact) || !nonemptyString(artifact.artifact_id) ||
    !nonemptyString(artifact.version) || !nonemptyString(artifact.url) || typeof artifact.sha256 !== "string" ||
    !/^[a-f\d]{64}$/i.test(artifact.sha256) || artifact.signing !== "ad_hoc" ||
    artifact.install_mode !== "local_ad_hoc" || artifact.development !== true)) return invalid();
  if (app !== null) {
    if (!isRecord(app) || typeof app.success !== "boolean" ||
      typeof app.state !== "string" || !["missing", "installed", "already_installed", "unsupported", "error"].includes(app.state) ||
      !nonemptyString(app.message) || !nonemptyString(app.next_action) ||
      (app.path !== undefined && !absoluteHostPath(app.path, host.os)) ||
      (app.version !== undefined && !nonemptyString(app.version)) ||
      (app.signing !== undefined && (typeof app.signing !== "string" || !["ad_hoc", "developer_id", "other"].includes(app.signing))) ||
      (app.development !== undefined && typeof app.development !== "boolean") ||
      (app.connector_compatible !== undefined && typeof app.connector_compatible !== "boolean") ||
      app.success !== (app.state === "missing" || app.state === "installed") ||
      (app.state === "installed" && (app.path === undefined || app.version === undefined || app.signing === undefined ||
        app.development === undefined || app.connector_compatible === undefined)) ||
      !host.supported || connector.state !== "verified") return invalid();
  }
  if (capability.supported !== (app !== null)) return invalid();
  if (install.available && (host.os !== "macos" || !["aarch64", "x86_64"].includes(host.arch) || !host.supported ||
    connector.state !== "verified" || !capability.supported || !isRecord(app) || app.state !== "missing" || !app.success ||
    !isRecord(artifact) || connector.version !== artifact.version || install.reason !== null)) return invalid();
  if (value.start !== undefined || value.observation !== undefined) {
    const { start, observation } = value;
    if (!isRecord(start) || typeof start.available !== "boolean" || !nullableString(start.reason) ||
      !isRecord(observation) || observation.schema_version !== 1 || !nonemptyString(observation.observed_at) ||
      !Number.isFinite(Date.parse(observation.observed_at)) || observation.app_runtime !== "not_verified" ||
      observation.permissions !== "not_verified" || !isRecord(observation.mcp)) return invalid();
    const mcp = observation.mcp;
    if (!nullableString(mcp.server_id) || (mcp.server_id !== null && mcp.server_id !== desktopId) ||
      typeof mcp.state !== "string" || !["not_observed", "connecting", "ready", "degraded", "stopped", "error"].includes(mcp.state) ||
      typeof mcp.tool_count !== "number" || !Number.isSafeInteger(mcp.tool_count) || mcp.tool_count < 0 ||
      mcp.configuration_applied !== "not_verified" || (mcp.server_id === null && mcp.state !== "not_observed")) return invalid();
    if (start.available && (!host.supported || !capability.supported || connector.state !== "verified" ||
      !isRecord(app) || app.state !== "installed" || !app.success || app.connector_compatible !== true ||
      app.version !== connector.version || start.reason !== null)) return invalid();
  }
  return value as unknown as NovaAppSetupReport;
};

/**
 * Extract the backend's finite failure reason from an official-Nova rejection.
 *
 * The server answers `409 {"error":{"type":"official_nova_unavailable","reason":"…"}}`.
 * `ApiError.message` only carries the generic HTTP status text for that shape, so
 * the reason has to be read from the preserved raw body. Without it the UI can
 * only say "not confirmed", which hides the one actionable fact — e.g. a release
 * asset whose bytes no longer match the accepted checksum.
 */
export const novaInstallReason = (error: unknown): string | null => {
  if (!isApiError(error) || typeof error.body !== "string") return null;
  try {
    const body = JSON.parse(error.body) as { error?: { reason?: unknown } };
    const reason = body.error?.reason;
    // Reasons are short, stable identifiers — never render arbitrary server text.
    return typeof reason === "string" && /^[a-z0-9_]{1,64}$/.test(reason) ? reason : null;
  } catch {
    return null;
  }
};

export class PluginService {
  async getNovaAppSetup(): Promise<NovaAppSetupReport> {
    return parseNovaAppSetup(await apiClient.get<unknown>("plugins/nova/app"));
  }

  async startNovaApp(report: NovaAppSetupReport): Promise<void> {
    if (!report.start?.available || !report.observation || !report.app?.version) {
      throw new Error("Nova app start could not be verified.");
    }
    const result = await apiClient.post<unknown>("plugins/nova/app/start", {
      observed_at: report.observation.observed_at,
      app_version: report.app.version,
    });
    if (!isRecord(result) || result.action !== "start_requested") {
      throw new Error("Nova app start could not be confirmed.");
    }
    parseNovaAppSetup(result.setup);
  }

  async installNovaApp(artifactId: string): Promise<void> {
    // The fixed backend catalogue owns URL/hash/signing. Ignore the POST report;
    // a separate fresh GET reconciles even a lost installation response.
    await apiClient.post<unknown>("plugins/nova/app/install", { artifact_id: artifactId });
  }

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
