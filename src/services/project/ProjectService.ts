/**
 * Project Service
 *
 * HTTP client for the Bamboo agent Project API at `/api/v1/projects`
 * (bigduu/Bamboo-agent#674).
 * All mutating endpoints use optimistic CAS via the `If-Match` header and
 * return the updated authoritative manifest.
 */
import { apiClient } from "../api";
import type {
  CreateProjectRequest,
  PatchProjectRequest,
  ProjectListResponse,
  ProjectManifest,
  ProjectResourceSummary,
  ProjectServiceOptions,
  WorkspaceBindingRequest,
} from "./types";

export class ProjectService {
  private options: { requestTimeoutMs: number };

  constructor(options: ProjectServiceOptions = {}) {
    this.options = {
      requestTimeoutMs: options.requestTimeoutMs ?? 30000,
    };
  }

  private etagHeader(revision: number): Record<string, string> {
    return { "If-Match": `"${revision}"` };
  }

  private signal(): AbortSignal | undefined {
    try {
      return AbortSignal.timeout(this.options.requestTimeoutMs);
    } catch {
      return undefined;
    }
  }

  async listProjects(): Promise<ProjectListResponse> {
    return apiClient.get<ProjectListResponse>("projects", {
      signal: this.signal(),
    });
  }

  async getProject(projectId: string): Promise<ProjectManifest> {
    return apiClient.get<ProjectManifest>(`projects/${encodeURIComponent(projectId)}`, {
      signal: this.signal(),
    });
  }

  async createProject(req: CreateProjectRequest): Promise<ProjectManifest> {
    return apiClient.post<ProjectManifest>("projects", req, {
      signal: this.signal(),
    });
  }

  async patchProject(
    projectId: string,
    revision: number,
    req: PatchProjectRequest,
  ): Promise<ProjectManifest> {
    return apiClient.patch<ProjectManifest>(`projects/${encodeURIComponent(projectId)}`, req, {
      headers: this.etagHeader(revision),
      signal: this.signal(),
    });
  }

  async bindWorkspace(
    projectId: string,
    revision: number,
    req: WorkspaceBindingRequest,
  ): Promise<ProjectManifest> {
    return apiClient.post<ProjectManifest>(
      `projects/${encodeURIComponent(projectId)}/workspaces`,
      req,
      {
        headers: this.etagHeader(revision),
        signal: this.signal(),
      },
    );
  }

  async unbindWorkspace(
    projectId: string,
    revision: number,
    req: WorkspaceBindingRequest,
  ): Promise<ProjectManifest> {
    return apiClient.request<ProjectManifest>(
      "DELETE",
      `projects/${encodeURIComponent(projectId)}/workspaces`,
      {
        headers: this.etagHeader(revision),
        body: JSON.stringify({ path: req.path }),
        signal: this.signal(),
      },
    );
  }

  async archiveProject(projectId: string, revision: number): Promise<ProjectManifest> {
    return apiClient.post<ProjectManifest>(
      `projects/${encodeURIComponent(projectId)}/archive`,
      {},
      {
        headers: this.etagHeader(revision),
        signal: this.signal(),
      },
    );
  }

  async unarchiveProject(projectId: string, revision: number): Promise<ProjectManifest> {
    return apiClient.post<ProjectManifest>(
      `projects/${encodeURIComponent(projectId)}/unarchive`,
      {},
      {
        headers: this.etagHeader(revision),
        signal: this.signal(),
      },
    );
  }

  async getProjectResources(projectId: string): Promise<ProjectResourceSummary> {
    return apiClient.get<ProjectResourceSummary>(
      `projects/${encodeURIComponent(projectId)}/resources`,
      {
        signal: this.signal(),
      },
    );
  }
}

// Singleton instance for application-wide use.
export const projectService = new ProjectService();
