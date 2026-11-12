import { debugLog } from "@shared/utils/debugFlags";
import { StateCreator } from "zustand";
import { modelService, ProxyAuthRequiredError } from "@services/chat/ModelService";
import { serviceFactory } from "@services/common/ServiceFactory";
import { useBambooConfigStore } from "@shared/store/bambooConfigStore";
import type { ProviderModelRef } from "@shared/types/providerModelRef";
import type { AppState } from "../";

let fetchModelsInFlight: Promise<void> | null = null;
let modelLoadRevision = 0;

export interface ModelSlice {
  // Model Management State
  models: string[];
  selectedModel: ProviderModelRef | undefined;
  isLoadingModels: boolean;
  modelsError: string | null;
  configModel: string | undefined; // model from config.json

  // Actions
  fetchModels: () => Promise<void>;
  /** Publish saved runtime IDs locally, invalidating earlier catalog-backed reads. */
  setSavedModelOptions: (models: string[]) => void;
  setSelectedModel: (model: ProviderModelRef) => void;
  loadConfigModel: () => Promise<void>;
}

export const createModelSlice: StateCreator<AppState, [], [], ModelSlice> = (set, get) => ({
  // Initial state - Don't read from localStorage anymore (provider-specific models)
  models: [],
  selectedModel: undefined,
  isLoadingModels: false,
  modelsError: null,
  configModel: undefined,

  setSavedModelOptions: (models) => {
    modelLoadRevision += 1;
    fetchModelsInFlight = null;
    const admitted = [...new Set(models)].sort();
    set({
      models: admitted,
      selectedModel: undefined,
      configModel: undefined, isLoadingModels: false, modelsError: null,
    });
  },

  // Model Management Actions
  setSelectedModel: (model) => {
    set({ selectedModel: model });
  },

  // Load model from config.json
  // NOTE: This is deprecated - models should be configured per-provider
  // Keeping this for backward compatibility with Copilot model list
  loadConfigModel: async () => {
    try {
      const config = await useBambooConfigStore.getState().loadConfig();
      const configModel = typeof config?.model === "string" ? config.model : undefined;
      if (configModel) {
        set({ configModel });
        // Don't write to localStorage anymore - provider-specific models are used now
      }
    } catch (error) {
      console.error("Failed to load model from config:", error);
    }
  },

  fetchModels: async () => {
    if (fetchModelsInFlight) {
      return fetchModelsInFlight;
    }

    const revision = ++modelLoadRevision;
    const request = (async () => {
      set({ isLoadingModels: true, modelsError: null });
      try {
        // Check setup status before fetching models
        try {
          const setupStatus = await serviceFactory.getSetupStatus();
          if (revision !== modelLoadRevision) return;
          if (!setupStatus.is_complete) {
            debugLog("[ModelSlice]", "Setup not complete, skipping model fetch");
            set({
              models: [],
              selectedModel: undefined,
              isLoadingModels: false,
              modelsError: "Complete setup to access all models",
            });
            return;
          }
        } catch (setupError) {
          console.error("Failed to check setup status:", setupError);
          // Continue with fetch if setup status check fails
        }

        if (revision !== modelLoadRevision) return;
        const availableModels = await modelService.getModels();
        if (revision !== modelLoadRevision) return;
        // This catalog contains bare model IDs. The composer validates its
        // provider-qualified choice against the saved provider snapshot.
        set({
          models: availableModels,
          modelsError: availableModels.length > 0 ? null : "No available model options",
        });

        if (get().models.length === 0) {
          console.warn("No models available from service");
        }
      } catch (err) {
        if (revision !== modelLoadRevision) return;
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error("Failed to fetch models:", err);

        if (err instanceof ProxyAuthRequiredError) {
          set({
            modelsError:
              errorMessage || "Proxy authentication required. Please configure proxy auth.",
          });
          return;
        }

        set({
          models: [],
          modelsError: errorMessage,
        });
      } finally {
        if (revision === modelLoadRevision) set({ isLoadingModels: false });
      }
    })();
    fetchModelsInFlight = request;

    try {
      await request;
    } finally {
      if (fetchModelsInFlight === request) fetchModelsInFlight = null;
    }
  },
});
