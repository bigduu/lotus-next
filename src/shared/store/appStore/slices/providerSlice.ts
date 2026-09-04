import { create } from "zustand";
import { settingsService } from "@services/config/SettingsService";
import {
  parseProviderInstancesConfig,
  ProviderSnapshotValidationError,
  type CreateProviderInstanceRequest,
  type ProviderInstance,
  type ProviderInstancesConfig,
  type ProviderKind,
  type UpdateProviderInstanceRequest,
} from "@shared/types/providerConfig";
import type {
  ProviderModelRef,
  ProviderCatalog,
  ProviderModelDescriptor,
} from "@shared/types/providerModelRef";

export type ProviderStatus = "idle" | "loading" | "ready" | "unavailable" | "incompatible";

const filterCatalogModelsForInstance = (
  catalog: ProviderCatalog | null,
  instanceId: string,
): ProviderModelDescriptor[] => {
  if (!catalog?.models || !instanceId.trim()) return [];
  return catalog.models.filter((model) => model.reference.provider === instanceId);
};

export interface ProviderState {
  /** The only authoritative provider state accepted from Bamboo. */
  providerSnapshot: ProviderInstancesConfig | null;
  providerStatus: ProviderStatus;
  providerError: string | null;

  /** Cached provider catalog. It is supplementary server state, not provider authority. */
  catalog: ProviderCatalog | null;
  isCatalogFetching: boolean;

  loadProviderInstances: () => Promise<ProviderInstancesConfig>;
  createProviderInstance: (
    request: CreateProviderInstanceRequest,
  ) => Promise<ProviderInstancesConfig>;
  updateProviderInstance: (
    instanceId: string,
    request: UpdateProviderInstanceRequest,
  ) => Promise<ProviderInstancesConfig>;
  deleteProviderInstance: (instanceId: string) => Promise<ProviderInstancesConfig>;
  setDefaultProviderInstance: (instanceId: string) => Promise<ProviderInstancesConfig>;
  loadCatalog: () => Promise<void>;
  fetchCatalogModels: (provider?: string) => Promise<void>;

  getActiveModel: () => string | undefined;
  getFastModel: () => string | undefined;
  getVisionModel: () => string | undefined;
  isProviderModelRefEnabled: () => boolean;
  getFastModelRef: () => ProviderModelRef | null;
  getVisionModelRef: () => ProviderModelRef | null;
  getModelsForProvider: (instanceId: string) => ProviderModelDescriptor[];
  getProviderInstance: (instanceId: string) => ProviderInstance | undefined;
  getProviderDisplayLabel: (instanceId: string) => string;
  getProviderType: (instanceId: string) => ProviderKind | undefined;
}

let providerLoadRevision = 0;

const mutationFailure = (operation: string): Error =>
  new Error(`Failed to ${operation} provider instance`);

export const useProviderStore = create<ProviderState>((set, get) => {
  const mutateAndRefresh = async (
    operation: string,
    mutation: () => Promise<unknown>,
  ): Promise<ProviderInstancesConfig> => {
    try {
      await mutation();
    } catch {
      // Mutation requests may contain credentials. Never propagate a backend
      // error that could echo the submitted payload into UI state or logs.
      throw mutationFailure(operation);
    }
    return get().loadProviderInstances();
  };

  return {
    providerSnapshot: null,
    providerStatus: "idle",
    providerError: null,
    catalog: null,
    isCatalogFetching: false,

    loadProviderInstances: async () => {
      const revision = ++providerLoadRevision;
      set({ providerStatus: "loading", providerError: null });
      try {
        const response = await settingsService.getProviderInstances();
        const snapshot = parseProviderInstancesConfig(response);
        if (revision === providerLoadRevision) {
          set({ providerSnapshot: snapshot, providerStatus: "ready", providerError: null });
        }
        return snapshot;
      } catch (error) {
        const incompatible = error instanceof ProviderSnapshotValidationError;
        const publicError = incompatible ? error.message : "Provider settings are unavailable";
        if (revision === providerLoadRevision) {
          set({
            providerSnapshot: null,
            providerStatus: incompatible ? "incompatible" : "unavailable",
            providerError: publicError,
          });
        }
        if (incompatible) throw error;
        throw new Error(publicError);
      }
    },

    createProviderInstance: (request) =>
      mutateAndRefresh("create", () => settingsService.createProviderInstance(request)),

    updateProviderInstance: (instanceId, request) =>
      mutateAndRefresh("update", () => settingsService.updateProviderInstance(instanceId, request)),

    deleteProviderInstance: (instanceId) =>
      mutateAndRefresh("delete", () => settingsService.deleteProviderInstance(instanceId)),

    setDefaultProviderInstance: (instanceId) =>
      mutateAndRefresh("set default", () => settingsService.setDefaultProviderInstance(instanceId)),

    loadCatalog: async () => {
      try {
        const catalog = await settingsService.getProviderCatalog();
        set({ catalog });
      } catch {
        // Catalog remains a best-effort supplementary cache in this slice.
      }
    },

    fetchCatalogModels: async (provider) => {
      set({ isCatalogFetching: true });
      try {
        await settingsService.fetchCatalogModels(provider);
        await get().loadCatalog();
      } catch {
        // Catalog lifecycle is intentionally outside the provider-authority migration.
      } finally {
        set({ isCatalogFetching: false });
      }
    },

    getActiveModel: () => {
      const model = get().providerSnapshot?.defaults?.chat.model.trim();
      return model || undefined;
    },

    getFastModel: () => {
      const model = get().providerSnapshot?.defaults?.fast?.model.trim();
      return model || get().getActiveModel();
    },

    getVisionModel: () => {
      const model = get().providerSnapshot?.defaults?.vision?.model.trim();
      return model || get().getActiveModel();
    },

    isProviderModelRefEnabled: () =>
      get().providerSnapshot?.features?.provider_model_ref === true,

    getFastModelRef: () => {
      const defaults = get().providerSnapshot?.defaults;
      if (defaults?.fast?.model.trim()) return defaults.fast;
      return defaults?.chat.model.trim() ? defaults.chat : null;
    },

    getVisionModelRef: () => {
      const defaults = get().providerSnapshot?.defaults;
      if (defaults?.vision?.model.trim()) return defaults.vision;
      return defaults?.chat.model.trim() ? defaults.chat : null;
    },

    getModelsForProvider: (instanceId) =>
      filterCatalogModelsForInstance(get().catalog, instanceId),

    getProviderInstance: (instanceId) =>
      get().providerSnapshot?.instances.find((instance) => instance.id === instanceId),

    getProviderDisplayLabel: (instanceId) => {
      const instance = get().providerSnapshot?.instances.find((item) => item.id === instanceId);
      return instance?.label || instance?.type || instanceId;
    },

    getProviderType: (instanceId) =>
      get().providerSnapshot?.instances.find((instance) => instance.id === instanceId)?.type,
  };
});
