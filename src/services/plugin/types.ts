/**
 * Plugin system types
 *
 * Mirrors the frozen bamboo `/api/v1/plugins` contract. Bamboo builds this
 * on an unmerged branch — these types match the agreed wire shape, not a
 * live backend, so PluginService normalizes defensively rather than trusting
 * the raw JSON (see mcp/McpService.ts for the same pattern).
 */

export type PluginStatus = "installing" | "installed";

export interface NovaAppReport {
  success: boolean;
  state: "missing" | "installed" | "already_installed" | "unsupported" | "error";
  message: string;
  next_action: string;
  path?: string;
  version?: string;
  signing?: "ad_hoc" | "developer_id" | "other";
  development?: boolean;
  connector_compatible?: boolean;
}

/** Host/connector ownership and passive app status; never a permission probe. */
export interface NovaAppSetupReport {
  plugin_id: "nova";
  host: { os: string; arch: string; supported: boolean; reason: string | null };
  connector: { state: "missing" | "installing" | "unverified" | "verified"; version: string | null; reason: string | null };
  capability: { supported: boolean; reason: string | null };
  app: NovaAppReport | null;
  install: { available: boolean; reason: string | null };
  artifact: { artifact_id: string; version: string; url: string; sha256: string; signing: "ad_hoc"; install_mode: "local_ad_hoc"; development: true } | null;
  manual_guidance: string;
  desktop_server_id: string | null;
  desktop_readiness: "not_tested";
  /** Additive v1 lifecycle support; absent on older setup-capable backends. */
  start?: { available: boolean; reason: string | null };
  observation?: {
    schema_version: 1;
    observed_at: string;
    app_runtime: "not_verified";
    permissions: "not_verified";
    mcp: {
      server_id: string | null;
      state: "not_observed" | "connecting" | "ready" | "degraded" | "stopped" | "error";
      tool_count: number;
      configuration_applied: "not_verified";
    };
  };
}

/** Host-derived authority for the optional connector; built-in memory is separate. */
export interface JianduSetupReport {
  plugin_id: "jiandu";
  host: { os: string; arch: string; libc: string | null; supported: boolean; reason: string | null };
  release: { version: string; manifest_url: string; sha256: string } | null;
  trust: { trusted: boolean; reason: string | null };
  install: { available: boolean; reason: string | null };
  installed: { state: "missing" | "installing" | "ready" | "unverified"; version: string | null; reason: string | null };
  external_client: { command: string; args: ["--data-dir", string] } | null;
}

export interface PluginSourceLocalDir {
  type: "local_dir";
  path: string;
}

export interface PluginSourceLocalArchive {
  type: "local_archive";
  path: string;
}

export interface PluginSourceUrl {
  type: "url";
  url: string;
  sha256?: string;
}

export type PluginSourceSpec =
  | PluginSourceLocalDir
  | PluginSourceLocalArchive
  | PluginSourceUrl;

/**
 * Sub-arrays are OMITTED (not empty-array) by the backend when there's
 * nothing of that kind registered — every field here is optional.
 */
export interface RegisteredResources {
  mcp_server_ids?: string[];
  preset_ids?: string[];
  skill_dirs?: string[];
  workflow_filenames?: string[];
}

export interface InstalledPluginView {
  id: string;
  name?: string;
  version: string;
  source: PluginSourceSpec;
  status: PluginStatus;
  registered: RegisteredResources;
}

export interface PluginListResponse {
  plugins: InstalledPluginView[];
}

export interface PluginInstallRequest {
  source: PluginSourceSpec;
}

/** Loose wire shape for defensive parsing — never trust the raw JSON as-is. */
export type PluginApiRecord = Partial<{
  id: string;
  name: string;
  version: string;
  source: unknown;
  status: string;
  registered: unknown;
}>;
