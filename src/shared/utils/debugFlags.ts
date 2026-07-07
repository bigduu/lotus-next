type DebugFlagKey = "bodhi_debug_ui_layout" | "bodhi_debug_verbose";

const isDevRuntime = (): boolean => Boolean(import.meta.env.DEV) && import.meta.env.MODE !== "test";

const readFlag = (key: DebugFlagKey): boolean => {
  if (!isDevRuntime()) return false;
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
};

export const isUILayoutDebugEnabled = (): boolean => readFlag("bodhi_debug_ui_layout");

export const uiLayoutDebug = (message: string, data?: Record<string, unknown>): void => {
  if (!isUILayoutDebugEnabled()) return;
  // eslint-disable-next-line no-console -- dev-only debug trace
  console.log(`[ui-layout] ${message}`, data ?? "");
};

/**
 * General-purpose dev-only debug logger.
 *
 * Usage: `debugLog("[Agent]", "Subscribing to events", { sessionId })`
 *
 * In production builds all calls are no-ops (zero cost).
 * In dev builds, set `localStorage.bodhi_debug_verbose = "1"` to enable.
 */
export const debugLog = (tag: string, message: string, ...args: unknown[]): void => {
  if (!isDevRuntime()) return;
  if (!readFlag("bodhi_debug_verbose")) return;
  // eslint-disable-next-line no-console -- dev-only debug trace
  console.log(`${tag} ${message}`, ...args);
};

/** localStorage key for the opt-in v2 WS MessagePack subprotocol feature flag. */
const API_V2_MSGPACK_FLAG_KEY = "bodhi_api_v2_msgpack";

/**
 * Feature flag: negotiate the binary `bamboo.v2.msgpack` subprotocol on the v2
 * WebSocket instead of the default JSON text frames. Same `/v2/stream` socket,
 * same envelope schema — only the wire encoding differs (smaller frames, aimed
 * at mobile/bandwidth-constrained clients). Desktop keeps JSON for
 * debuggability.
 *
 * Default OFF → JSON. The offer is safe against a JSON-only backend: if the
 * server does not echo `bamboo.v2.msgpack` on the handshake (`ws.protocol`
 * stays empty), the client transparently stays on JSON.
 *
 * Exact values (honored in any build, not just dev):
 *  - key unset / any value EXCEPT "1" → msgpack OFF → JSON (default).
 *  - "1" → msgpack ON: offer `bamboo.v2.msgpack` as the WS subprotocol.
 *
 * Enable: `localStorage.setItem("bodhi_api_v2_msgpack", "1")` then reload.
 * Disable: `localStorage.removeItem("bodhi_api_v2_msgpack")` then reload.
 */
export const isApiV2MsgpackEnabled = (): boolean => {
  try {
    return localStorage.getItem(API_V2_MSGPACK_FLAG_KEY) === "1";
  } catch {
    // Storage unavailable (e.g. SSR/private-mode): default OFF (JSON).
    return false;
  }
};
