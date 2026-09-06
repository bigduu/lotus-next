import type { StateCreator } from "zustand";
import {
  agentClient,
  parseSessionPermissionMode,
  sessionPermissionRevision,
  SessionPermissionContractError,
  type SessionPermissionMode,
  type SessionPermissionSnapshot,
  type SessionSummary,
} from "@services/chat/AgentService";
import { isApiError } from "@services/api";
import type { AppState } from "../";

export type PermissionModeError = "conflict" | "rejected" | "ambiguous" | "unsupported" | "unconfirmed" | "stale" | "changed";
export interface PermissionModeRequest {
  status: "loading" | "saving" | "ready" | "unsupported" | "unconfirmed";
  operationId: number;
  error?: PermissionModeError;
}

export interface PermissionModeSlice {
  /** Transient request state only. The one mode/ETag snapshot lives in ChatItem.config. */
  permissionModeRequests: Record<string, PermissionModeRequest>;
  refreshSessionPermissionMode: (sessionId: string) => Promise<void>;
  changeSessionPermissionMode: (sessionId: string, mode: SessionPermissionMode, etag: string) => Promise<void>;
  reconcileSessionPermissionModes: (summaries: SessionSummary[]) => void;
  resetSessionPermissionModes: (sessionIds?: string[]) => void;
}

interface Operation {
  id: number;
  promise?: Promise<void>;
  reconcileRequested?: boolean;
}

export const createPermissionModeSlice: StateCreator<AppState, [], [], PermissionModeSlice> = (set, get) => {
  // Per-store, per-session fences survive pane navigation, but never page reload.
  const operations = new Map<string, Operation>();
  let sequence = 0;
  const chatFor = (id: string) => get().chats.find((chat) => chat.id === id);
  const isCurrent = (id: string, operation: Operation) =>
    operations.get(id) === operation &&
    get().permissionModeRequests[id]?.operationId === operation.id && Boolean(chatFor(id));

  const setRequest = (id: string, operation: Operation, status: PermissionModeRequest["status"], error?: PermissionModeError) => {
    if (!isCurrent(id, operation)) return;
    set((state) => ({
      permissionModeRequests: { ...state.permissionModeRequests, [id]: { status, operationId: operation.id, error } },
    }));
  };

  const begin = (id: string, status: "loading" | "saving"): Operation => {
    const operation = { id: ++sequence };
    operations.set(id, operation);
    set((state) => ({
      permissionModeRequests: { ...state.permissionModeRequests, [id]: { status, operationId: operation.id } },
    }));
    return operation;
  };

  const confirm = (id: string, operation: Operation, snapshot: SessionPermissionSnapshot, error?: PermissionModeError, status: "ready" | "saving" = "ready") => {
    if (!isCurrent(id, operation)) return false;
    const current = chatFor(id)!;
    const previousRevision = sessionPermissionRevision(current.config.permissionModeEtag);
    const nextRevision = sessionPermissionRevision(snapshot.etag);
    if (
      snapshot.sessionId !== id || !parseSessionPermissionMode(snapshot.mode) || nextRevision === null ||
      (previousRevision !== null && (nextRevision < previousRevision ||
        (nextRevision === previousRevision && current.config.permissionMode !== snapshot.mode)))
    ) {
      setRequest(id, operation, "unconfirmed", "stale");
      return false;
    }
    set((state) => ({
      chats: state.chats.map((chat) => chat.id === id ? {
        ...chat,
        config: {
          ...chat.config,
          permissionMode: snapshot.mode,
          permissionModeEtag: snapshot.etag,
          bypassPermissions: snapshot.mode !== "default",
        },
      } : chat),
      permissionModeRequests: {
        ...state.permissionModeRequests,
        [id]: { status: status === "ready" && operation.reconcileRequested ? "loading" : status, operationId: operation.id, error },
      },
    }));
    return true;
  };

  const finish = async (id: string, operation: Operation) => {
    // Coalesce hints received during an operation into a read after it. Keep
    // the same fence until that read settles; a hint is never another PATCH.
    while (isCurrent(id, operation) && operation.reconcileRequested) {
      operation.reconcileRequested = false;
      const reason = get().permissionModeRequests[id]?.error;
      setRequest(id, operation, "loading", reason);
      try {
        confirm(id, operation, await agentClient.getSessionPermissionMode(id), reason);
      } catch (error) {
        const unsupported = error instanceof SessionPermissionContractError;
        setRequest(id, operation, unsupported ? "unsupported" : "unconfirmed", unsupported ? "unsupported" : "unconfirmed");
      }
    }
    if (operations.get(id) === operation) operations.delete(id);
  };

  return {
    permissionModeRequests: {},

    refreshSessionPermissionMode: (id) => {
      const active = operations.get(id);
      if (active) return active.promise ?? Promise.resolve();
      if (!chatFor(id)) return Promise.resolve();
      const operation = begin(id, "loading");
      operation.promise = (async () => {
        try {
          confirm(id, operation, await agentClient.getSessionPermissionMode(id));
        } catch (error) {
          const unsupported = error instanceof SessionPermissionContractError;
          setRequest(id, operation, unsupported ? "unsupported" : "unconfirmed", unsupported ? "unsupported" : "unconfirmed");
        }
      })().finally(() => finish(id, operation));
      return operation.promise;
    },

    changeSessionPermissionMode: (id, mode, etag) => {
      const chat = chatFor(id);
      const request = get().permissionModeRequests[id];
      // Synchronous fence, including repeated events before React can render disabled.
      if (operations.has(id) || !chat || request?.status !== "ready" ||
        !parseSessionPermissionMode(mode) || sessionPermissionRevision(etag) === null) return Promise.resolve();
      if (chat.config.permissionModeEtag !== etag) {
        set((state) => ({ permissionModeRequests: {
          ...state.permissionModeRequests, [id]: { ...request, error: "changed" },
        } }));
        return Promise.resolve();
      }
      if (chat.config.permissionMode === mode) return Promise.resolve();
      const observedMode = chat.config.permissionMode;
      const operation = begin(id, "saving");
      operation.promise = (async () => {
        // Other metadata (model/title) shares the revision. Recheck once before
        // the first write without changing the user's observed mode or intent.
        let fresh: SessionPermissionSnapshot;
        try {
          fresh = await agentClient.getSessionPermissionMode(id);
        } catch (error) {
          const unsupported = error instanceof SessionPermissionContractError;
          setRequest(id, operation, unsupported ? "unsupported" : "unconfirmed", unsupported ? "unsupported" : "unconfirmed");
          return;
        }
        const changed = fresh.mode !== observedMode;
        if (!confirm(id, operation, fresh, changed ? "changed" : undefined, changed ? "ready" : "saving") || changed) return;
        try {
          const snapshot = await agentClient.patchSessionPermissionMode(id, mode, fresh.etag);
          confirm(id, operation, snapshot, snapshot.mode === mode ? undefined : "changed");
        } catch (error) {
          if (!isCurrent(id, operation)) return;
          const reason: PermissionModeError = isApiError(error) && error.status === 412
            ? "conflict"
            : isApiError(error) && error.status < 500 ? "rejected" : "ambiguous";
          // A failed/lost write is never retried. Read the actual server state once.
          try {
            // This new read also consumes any hint received before it starts.
            // Hints arriving during it remain queued for finish.
            operation.reconcileRequested = false;
            confirm(id, operation, await agentClient.getSessionPermissionMode(id), reason);
          } catch {
            setRequest(id, operation, "unconfirmed", "unconfirmed");
          }
        }
      })().finally(() => finish(id, operation));
      return operation.promise;
    },

    reconcileSessionPermissionModes: (summaries) => {
      const alive = new Set(get().chats.map((chat) => chat.id));
      get().resetSessionPermissionModes(Object.keys(get().permissionModeRequests).filter((id) => !alive.has(id)));
      for (const summary of summaries) {
        const request = get().permissionModeRequests[summary.id];
        const chat = chatFor(summary.id);
        if (!request || !chat) continue;
        // An index row has no ETag: a differing row is a hint to GET, never a write
        // authority. This also makes stale index responses harmless after a PATCH.
        const differs = parseSessionPermissionMode(summary.permission_mode) !== chat.config.permissionMode;
        const active = operations.get(summary.id);
        if (active) {
          if (differs || !chat.config.permissionModeEtag) active.reconcileRequested = true;
          continue;
        }
        if (request.status !== "ready" || !chat.config.permissionModeEtag || differs) {
          void get().refreshSessionPermissionMode(summary.id);
        }
      }
    },

    resetSessionPermissionModes: (ids) => {
      const removed = ids ?? [...new Set([...operations.keys(), ...Object.keys(get().permissionModeRequests)])];
      if (removed.length === 0) return;
      for (const id of removed) operations.delete(id);
      set((state) => {
        const requests = { ...state.permissionModeRequests };
        for (const id of removed) delete requests[id];
        return { permissionModeRequests: requests };
      });
    },
  };
};
