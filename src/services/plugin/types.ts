/**
 * Plugin system types
 *
 * Mirrors the frozen bamboo `/api/v1/plugins` contract. Bamboo builds this
 * on an unmerged branch — these types match the agreed wire shape, not a
 * live backend, so PluginService normalizes defensively rather than trusting
 * the raw JSON (see mcp/McpService.ts for the same pattern).
 */

export type PluginStatus = "installing" | "installed";

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
