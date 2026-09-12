import { create } from "zustand";
import {
  settingsService,
  type FetchModelsResponse,
} from "@services/config/SettingsService";
import {
  parseProviderInstancesConfig,
  parseProviderInstance,
  findProviderSnapshotRelationIssues,
  ProviderSnapshotValidationError,
  type CreateProviderInstanceRequest,
  type ProviderInstance,
  type ProviderInstancesConfig,
  type ProviderKind,
  type ProviderSnapshotRelationIssue,
  type UpdateProviderInstanceRequest,
} from "@shared/types/providerConfig";
import type {
  ProviderModelRef,
  ProviderCatalog,
  ProviderModelDescriptor,
} from "@shared/types/providerModelRef";

export type ProviderStatus =
  | "idle"
  | "loading"
  | "ready"
  | "degraded"
  | "unavailable"
  | "incompatible";

export interface CreateProviderInstanceResult {
  /** The exact validated instance returned by Bamboo, or null for a malformed response. */
  instance: ProviderInstance | null;
  responseValid: boolean;
  /** False means creation succeeded but the canonical collection reload failed. */
  authorityRefreshed: boolean;
  /** True only when the refreshed collection contains the returned instance id. */
  instanceConfirmed: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isProviderModelDescriptor = (value: unknown): value is ProviderModelDescriptor => {
  if (!isRecord(value) || !isRecord(value.reference) || !isRecord(value.capabilities)) {
    return false;
  }
  return (
    typeof value.reference.provider === "string" &&
    value.reference.provider.trim().length > 0 &&
    typeof value.reference.model === "string" &&
    value.reference.model.trim().length > 0 &&
    typeof value.display_name === "string" &&
    typeof value.provider_display_name === "string" &&
    typeof value.capabilities.supports_tools === "boolean" &&
    typeof value.capabilities.supports_vision === "boolean" &&
    typeof value.capabilities.supports_reasoning === "boolean"
  );
};

const parseFetchedModels = (value: unknown): ProviderModelDescriptor[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(isProviderModelDescriptor)) {
    throw new Error("Provider model refresh returned invalid models");
  }
  return value;
};

const modelDiscoveryFailure = (): Error => new Error("Provider model discovery failed");

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
  /** Structurally valid state exposed only to Settings while references are repaired. */
  providerRepairSnapshot: ProviderInstancesConfig | null;
  providerRepairIssues: ProviderSnapshotRelationIssue[];
  providerStatus: ProviderStatus;
  providerError: string | null;

  /** Cached provider catalog. It is supplementary server state, not provider authority. */
  catalog: ProviderCatalog | null;
  isCatalogFetching: boolean;

  loadProviderInstances: () => Promise<ProviderInstancesConfig>;
  createProviderInstance: (
    request: CreateProviderInstanceRequest,
  ) => Promise<CreateProviderInstanceResult>;
  updateProviderInstance: (
    instanceId: string,
    request: UpdateProviderInstanceRequest,
  ) => Promise<ProviderInstancesConfig>;
  deleteProviderInstance: (instanceId: string) => Promise<ProviderInstancesConfig>;
  loadCatalog: () => Promise<void>;
  fetchCatalogModels: (provider?: string) => Promise<FetchModelsResponse>;

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
let catalogLoadRevision = 0;
let catalogLoadPromise: Promise<void> | null = null;

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
    providerRepairSnapshot: null,
    providerRepairIssues: [],
    providerStatus: "idle",
    providerError: null,
    catalog: null,
    isCatalogFetching: false,

    loadProviderInstances: async () => {
      const revision = ++providerLoadRevision;
      // Consumers read providerSnapshot directly in several hot paths. Revoke
      // the previous runtime authority before any reload so a committed CRUD
      // mutation can never leave stale provider/default references usable.
      set({
        providerSnapshot: null,
        providerRepairSnapshot: null,
        providerRepairIssues: [],
        providerStatus: "loading",
        providerError: null,
      });
      try {
        const response = await settingsService.getProviderInstances();
        const snapshot = parseProviderInstancesConfig(response);
        const repairIssues = findProviderSnapshotRelationIssues(snapshot);
        if (revision === providerLoadRevision) {
          const degraded = repairIssues.length > 0;
          set({
            providerSnapshot: degraded ? null : snapshot,
            providerRepairSnapshot: degraded ? snapshot : null,
            providerRepairIssues: repairIssues,
            providerStatus: degraded ? "degraded" : "ready",
            providerError: degraded
              ? `Provider routing or model preferences contain ${repairIssues.length} unknown instance reference${repairIssues.length === 1 ? "" : "s"}`
              : null,
          });
        }
        return snapshot;
      } catch (error) {
        const incompatible = error instanceof ProviderSnapshotValidationError;
        const publicError = incompatible ? error.message : "Provider settings are unavailable";
        if (revision === providerLoadRevision) {
          set({
            providerSnapshot: null,
            providerRepairSnapshot: null,
            providerRepairIssues: [],
            providerStatus: incompatible ? "incompatible" : "unavailable",
            providerError: publicError,
          });
        }
        if (incompatible) throw error;
        throw new Error(publicError);
      }
    },

    createProviderInstance: async (request) => {
      let response: unknown;
      try {
        response = await settingsService.createProviderInstance(request);
      } catch {
        throw mutationFailure("create");
      }
      let created: ProviderInstance | null = null;
      try {
        created = parseProviderInstance(response, "Created provider instance");
      } catch {
        // The HTTP mutation succeeded, so this is partial success even though
        // its malformed response cannot safely drive an instance-scoped fetch.
      }
      try {
        const refreshed = await get().loadProviderInstances();
        const instanceConfirmed =
          created !== null && refreshed.instances.some((instance) => instance.id === created.id);
        return {
          instance: created,
          responseValid: created !== null,
          authorityRefreshed: true,
          instanceConfirmed,
        };
      } catch {
        // The create request has already committed. Preserve that outcome so
        // callers never invite a duplicate create after a refresh failure.
        return {
          instance: created,
          responseValid: created !== null,
          authorityRefreshed: false,
          instanceConfirmed: false,
        };
      }
    },

    updateProviderInstance: (instanceId, request) =>
      mutateAndRefresh("update", () => settingsService.updateProviderInstance(instanceId, request)),

    deleteProviderInstance: (instanceId) =>
      mutateAndRefresh("delete", () => settingsService.deleteProviderInstance(instanceId)),

    loadCatalog: () => {
      // StrictMode and provider-authority reloads can remount Settings content.
      // Share one in-flight initial catalog read instead of querying every
      // upstream provider again for the same visible Settings page.
      if (catalogLoadPromise) return catalogLoadPromise;

      const revision = ++catalogLoadRevision;
      let request: Promise<void>;
      request = Promise.resolve()
        .then(() => settingsService.getProviderCatalog())
        .then((catalog) => {
          // A later targeted POST response is more precise than this full read.
          // Never let a slow initial catalog request overwrite that response.
          if (revision === catalogLoadRevision) set({ catalog });
        })
        .catch(() => {
          // Catalog remains a best-effort supplementary cache in this slice.
        })
        .finally(() => {
          if (catalogLoadPromise === request) catalogLoadPromise = null;
        });
      catalogLoadPromise = request;
      return request;
    },

    fetchCatalogModels: async (provider) => {
      set({ isCatalogFetching: true });
      try {
        const response = await settingsService.fetchCatalogModels(provider);
        if (!Array.isArray(response.fetched)) {
          throw new Error("Provider model refresh returned an invalid response");
        }
        if (provider) {
          const result = response.fetched.find(
            (item) => isRecord(item) && item.provider === provider,
          );
          if (!result) throw modelDiscoveryFailure();
          if (result.error !== undefined && typeof result.error !== "string") {
            throw modelDiscoveryFailure();
          }
          if (result.error?.trim()) throw modelDiscoveryFailure();

          const models = parseFetchedModels(result.models).filter(
            (model) => model.reference.provider === provider,
          );
          ++catalogLoadRevision;
          set((state) => ({
            catalog: {
              providers: state.catalog?.providers ?? [],
              models: [
                ...(state.catalog?.models ?? []).filter(
                  (model) => model.reference.provider !== provider,
                ),
                ...models,
              ],
              updated_at: state.catalog?.updated_at,
            },
          }));
          return response;
        }

        const successfulResults = response.fetched.filter(
          (result) =>
            isRecord(result) &&
            typeof result.provider === "string" &&
            (result.error === undefined || typeof result.error === "string") &&
            !result.error?.trim(),
        );
        const refreshedProviders = new Set(
          successfulResults.map((result) => result.provider as string),
        );
        const fetchedModels = successfulResults.flatMap((result) =>
          parseFetchedModels(result.models).filter(
            (model) => model.reference.provider === result.provider,
          ),
        );
        ++catalogLoadRevision;
        set((state) => ({
          catalog: {
            providers: state.catalog?.providers ?? [],
            models: [
              ...(state.catalog?.models ?? []).filter(
                (model) => !refreshedProviders.has(model.reference.provider),
              ),
              ...fetchedModels,
            ],
            updated_at: state.catalog?.updated_at,
          },
        }));
        return response;
      } catch {
        // Upstream/provider errors may contain credentials or echoed request
        // details. Expose one stable category and retain no private message.
        throw modelDiscoveryFailure();
      } finally {
        set({ isCatalogFetching: false });
      }
    },

    getActiveModel: () => {
      if (get().providerStatus !== "ready") return undefined;
      const model = get().providerSnapshot?.defaults?.chat.model.trim();
      return model || undefined;
    },

    getFastModel: () => {
      if (get().providerStatus !== "ready") return undefined;
      const model = get().providerSnapshot?.defaults?.fast?.model.trim();
      return model || get().getActiveModel();
    },

    getVisionModel: () => {
      if (get().providerStatus !== "ready") return undefined;
      const model = get().providerSnapshot?.defaults?.vision?.model.trim();
      return model || get().getActiveModel();
    },

    isProviderModelRefEnabled: () =>
      get().providerStatus === "ready" &&
      get().providerSnapshot?.features?.provider_model_ref === true,

    getFastModelRef: () => {
      if (get().providerStatus !== "ready") return null;
      const defaults = get().providerSnapshot?.defaults;
      if (defaults?.fast?.model.trim()) return defaults.fast;
      return defaults?.chat.model.trim() ? defaults.chat : null;
    },

    getVisionModelRef: () => {
      if (get().providerStatus !== "ready") return null;
      const defaults = get().providerSnapshot?.defaults;
      if (defaults?.vision?.model.trim()) return defaults.vision;
      return defaults?.chat.model.trim() ? defaults.chat : null;
    },

    getModelsForProvider: (instanceId) =>
      filterCatalogModelsForInstance(get().catalog, instanceId),

    getProviderInstance: (instanceId) =>
      get().providerSnapshot?.instances.find((instance) => instance.id === instanceId),

    getProviderDisplayLabel: (instanceId) => {
      const snapshot = get().providerSnapshot ?? get().providerRepairSnapshot;
      const instance = snapshot?.instances.find((item) => item.id === instanceId);
      return instance?.label || instance?.type || instanceId;
    },

    getProviderType: (instanceId) =>
      get().providerSnapshot?.instances.find((instance) => instance.id === instanceId)?.type,
  };
});
