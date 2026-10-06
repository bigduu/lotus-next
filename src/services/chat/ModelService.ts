import { ApiError } from "../api";
import { settingsService } from "../config/SettingsService";

export class ProxyAuthRequiredError extends Error {
  readonly code = "proxy_auth_required";

  constructor(message = "Proxy authentication required") {
    super(message);
    this.name = "ProxyAuthRequiredError";
  }
}

export class ModelService {
  private static instance: ModelService;

  private constructor() {}

  static getInstance(): ModelService {
    if (!ModelService.instance) {
      ModelService.instance = new ModelService();
    }
    return ModelService.instance;
  }

  async getModels(provider?: string): Promise<string[]> {
    try {
      const catalog = await settingsService.getProviderCatalog();

      // Discovery is a candidate step. Only the admitted runtime catalog supplies options.
      const modelIds: string[] = [];
      for (const model of catalog.models) {
        if (provider && model.reference?.provider !== provider) continue;
        if (model.reference?.model) modelIds.push(model.reference.model);
      }

      // Remove duplicates and sort
      const uniqueModelIds = [...new Set(modelIds)].sort();
      return uniqueModelIds;
    } catch (error) {
      console.error("Failed to fetch models from Provider Catalog:", error);

      // Handle proxy auth error
      if (error instanceof ApiError) {
        if (error.status === 428) {
          throw new ProxyAuthRequiredError(error.message);
        }

        // Try to parse error code from body
        let body: unknown;
        if (error.body) {
          try {
            body = JSON.parse(error.body);
          } catch {
            // Ignore parse errors
          }
        }

        if (
          body &&
          typeof body === "object" &&
          "error" in body &&
          (body as { error?: { code?: string; message?: string } }).error?.code ===
            "proxy_auth_required"
        ) {
          throw new ProxyAuthRequiredError(
            (body as { error?: { message?: string } }).error?.message || error.message,
          );
        }
      }

      throw error;
    }
  }
}

export const modelService = ModelService.getInstance();
