/**
 * Command Service
 *
 * Unified command list (workflows + skills + MCP tools) from the backend.
 *
 * Backend routes (bamboo-server routes/bamboo_v1.rs, mounted under the /v1 scope,
 * i.e. the standard `apiClient` base):
 * - GET /v1/commands                     → CommandListResponse
 * - GET /v1/commands/{command_type}/{id} → command detail (shape depends on type)
 */
import { apiClient } from "../api";

export type CommandType = "workflow" | "skill" | "mcp";

/**
 * One unified command entry.
 * Mirrors bamboo-server `handlers/command/types.rs::CommandItem`
 * (`command_type` is serialized on the wire as `type`).
 */
export interface CommandItem {
  id: string;
  name: string;
  display_name: string;
  description: string;
  type: CommandType | string;
  category?: string;
  tags?: string[];
  metadata: Record<string, unknown> | null;
}

/** Mirrors bamboo-server `CommandListResponse`. */
export interface CommandListResponse {
  commands: CommandItem[];
  total: number;
}

/** GET /v1/commands/workflow/{name} response (see command/handlers.rs). */
export interface WorkflowCommandDetail {
  /** `workflow-{name}` */
  id: string;
  name: string;
  content: string;
  type: "workflow";
}

export class CommandService {
  /** List all available commands (workflows, skills and MCP tools). */
  async listCommands(): Promise<CommandListResponse> {
    return apiClient.get<CommandListResponse>("/commands");
  }

  /**
   * Get one command by type and id.
   * - `workflow`: id = workflow name (file stem) → {@link WorkflowCommandDetail}
   * - `skill`:    id = skill id → skill definition JSON
   * - `mcp`:      not supported by the backend (always 404)
   */
  async getCommand<T = unknown>(type: CommandType, id: string): Promise<T> {
    return apiClient.get<T>(`/commands/${encodeURIComponent(type)}/${encodeURIComponent(id)}`);
  }

  /** Convenience: fetch a workflow command's markdown content. */
  async getWorkflowCommand(name: string): Promise<WorkflowCommandDetail> {
    return this.getCommand<WorkflowCommandDetail>("workflow", name);
  }
}

/**
 * Singleton instance
 */
export const commandService = new CommandService();
