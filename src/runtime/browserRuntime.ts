import {
  createRuntimeConfig,
  createRuntimeEndpointSet,
  getRuntimeConfig,
  RuntimeConfigurationError,
  type RuntimeConfig,
  type RuntimeEndpointSource,
  type RuntimeHost,
} from "./runtimeConfig";

export const BACKEND_OVERRIDE_STORAGE_KEY = "copilot_backend_base_url";

export interface PublicBuildInput {
  readonly backendBaseUrl?: string;
  readonly version?: string;
  readonly revision?: string;
  readonly mode?: string;
  readonly development?: boolean;
}

export interface RuntimeLocationInput {
  readonly href: string;
}

export interface RuntimeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface BrowserRuntimeInput {
  /** `null` explicitly disables ambient `globalThis.location` discovery. */
  readonly location?: RuntimeLocationInput | null;
  readonly storage?: RuntimeStorage | null;
  readonly build?: PublicBuildInput;
  /** `null` explicitly disables ambient Tauri capability discovery. */
  readonly tauriInternals?: unknown | null;
  /** `null` explicitly disables the ambient Bodhi sidecar-port injection. */
  readonly sidecarPort?: unknown | null;
  readonly embedded?: boolean;
  readonly warn?: (message: string) => void;
}

type CanonicalHostname =
  | { readonly kind: "dns"; readonly labels: readonly string[] }
  | { readonly kind: "ipv4"; readonly octets: readonly number[] }
  | { readonly kind: "ipv6"; readonly hextets: readonly number[] };

const parseCanonicalIpv4 = (hostname: string): readonly number[] | null => {
  const parts = hostname.split(".");
  if (parts.length !== 4) return null;

  const octets = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) return Number.NaN;
    return Number(part);
  });
  return octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
    ? octets
    : null;
};

const parseCanonicalIpv6 = (hostname: string): readonly number[] | null => {
  if (!hostname.includes(":")) return null;

  const halves = hostname.split("::");
  if (halves.length > 2) return null;

  const parseHalf = (half: string): readonly number[] | null => {
    if (!half) return [];
    const parts = half.split(":");
    if (parts.some((part) => !/^[\da-f]{1,4}$/.test(part))) return null;
    return parts.map((part) => Number.parseInt(part, 16));
  };

  const left = parseHalf(halves[0] ?? "");
  const right = parseHalf(halves[1] ?? "");
  if (!left || !right) return null;

  if (halves.length === 1) return left.length === 8 ? left : null;

  const omittedCount = 8 - left.length - right.length;
  if (omittedCount < 1) return null;
  return [...left, ...Array<number>(omittedCount).fill(0), ...right];
};

/**
 * `URL.hostname` supplies the WHATWG-canonical form (including canonicalizing
 * IPv4 shorthand and integer/hex spellings). Parse that form structurally so
 * loopback policy does not depend on an incomplete list of string spellings.
 */
const parseCanonicalHostname = (hostname: string): CanonicalHostname => {
  const normalized = hostname.trim().toLowerCase();
  const unbracketed = normalized.startsWith("[") && normalized.endsWith("]")
    ? normalized.slice(1, -1)
    : normalized;

  const ipv4 = parseCanonicalIpv4(unbracketed);
  if (ipv4) return { kind: "ipv4", octets: ipv4 };

  const ipv6 = parseCanonicalIpv6(unbracketed);
  if (ipv6) return { kind: "ipv6", hextets: ipv6 };

  const dnsName = unbracketed.replace(/\.+$/, "");
  return { kind: "dns", labels: dnsName.split(".") };
};

const isLoopbackHostname = (hostname: string): boolean => {
  const parsed = parseCanonicalHostname(hostname);
  if (parsed.kind === "dns") {
    return parsed.labels.at(-1) === "localhost";
  }
  if (parsed.kind === "ipv4") {
    return parsed.octets[0] === 127;
  }

  const isIpv6Loopback = parsed.hextets.slice(0, 7).every((hextet) => hextet === 0) &&
    parsed.hextets[7] === 1;
  const isIpv4Mapped = parsed.hextets.slice(0, 5).every((hextet) => hextet === 0) &&
    parsed.hextets[5] === 0xffff;
  const mappedIpv4FirstOctet = (parsed.hextets[6] ?? 0) >>> 8;
  return isIpv6Loopback || (isIpv4Mapped && mappedIpv4FirstOctet === 127);
};

const parsePageUrl = (locationInput: RuntimeLocationInput | null | undefined): URL | null => {
  if (!locationInput?.href) return null;
  try {
    return new URL(locationInput.href);
  } catch {
    throw new RuntimeConfigurationError("The page location is not a valid URL.");
  }
};

const getDefaultStorage = (): RuntimeStorage | null => {
  try {
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
  } catch {
    return null;
  }
};

const assertSafeForPage = (backendBaseUrl: string, pageUrl: URL | null): string => {
  const endpoints = createRuntimeEndpointSet(backendBaseUrl);
  const endpoint = new URL(endpoints.standardApi);

  if (pageUrl?.protocol === "https:" && endpoint.protocol !== "https:") {
    throw new RuntimeConfigurationError(
      "An HTTPS Lotus Next page cannot use an insecure HTTP backend endpoint.",
    );
  }

  if (
    pageUrl &&
    (pageUrl.protocol === "http:" || pageUrl.protocol === "https:") &&
    !isLoopbackHostname(pageUrl.hostname) &&
    isLoopbackHostname(endpoint.hostname)
  ) {
    throw new RuntimeConfigurationError(
      "A remotely served Lotus Next page cannot target a loopback backend.",
    );
  }

  return endpoints.standardApi;
};

const readStoredOverride = (
  storage: RuntimeStorage | null | undefined,
  pageUrl: URL | null,
  warn: (message: string) => void,
): string | null => {
  if (!storage) return null;

  let stored: string | null;
  try {
    stored = storage.getItem(BACKEND_OVERRIDE_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!stored) return null;

  try {
    return assertSafeForPage(stored, pageUrl);
  } catch (error) {
    try {
      storage.removeItem(BACKEND_OVERRIDE_STORAGE_KEY);
    } catch {
      // A storage implementation can be read-only; rejection still succeeds.
    }
    const reason = error instanceof Error ? error.message : String(error);
    warn(`Removed unsafe backend override: ${reason}`);
    return null;
  }
};

const isTrustedTauriRuntime = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { invoke?: unknown }).invoke === "function";

const isRemoteWebPage = (pageUrl: URL | null): boolean =>
  Boolean(
    pageUrl &&
    (pageUrl.protocol === "http:" || pageUrl.protocol === "https:") &&
    !isLoopbackHostname(pageUrl.hostname),
  );

const resolveHost = (input: BrowserRuntimeInput, pageUrl: URL | null): RuntimeHost => {
  // A normal remote page can forge JavaScript globals. Only a bundled/custom-
  // scheme or loopback webview may turn callable Tauri evidence into native
  // capabilities; a forged remote hint stays a browser runtime.
  const desktop = isTrustedTauriRuntime(input.tauriInternals) && !isRemoteWebPage(pageUrl);
  const kind = desktop ? "bodhi-desktop" : input.embedded ? "bamboo-embedded" : "browser";
  return {
    kind,
    capabilities: {
      nativeFileSystem: desktop,
      nativeNotifications: desktop,
      externalShell: desktop,
      sidecarBackend: desktop,
    },
  };
};

const resolveSidecarBackend = (input: BrowserRuntimeInput, pageUrl: URL | null): string | null => {
  if (
    !isTrustedTauriRuntime(input.tauriInternals) ||
    input.sidecarPort === undefined ||
    input.sidecarPort === null
  ) {
    return null;
  }
  if (
    isRemoteWebPage(pageUrl)
  ) {
    throw new RuntimeConfigurationError(
      "A remotely served Lotus Next page cannot accept a loopback Bodhi sidecar injection.",
    );
  }
  if (
    typeof input.sidecarPort !== "number" ||
    !Number.isInteger(input.sidecarPort) ||
    input.sidecarPort < 1 ||
    input.sidecarPort > 65_535
  ) {
    throw new RuntimeConfigurationError("The Bodhi sidecar port must be an integer from 1 to 65535.");
  }
  if (pageUrl?.protocol === "https:") {
    throw new RuntimeConfigurationError(
      "An HTTPS Lotus Next page cannot connect to an HTTP Bodhi sidecar.",
    );
  }
  return `http://127.0.0.1:${input.sidecarPort}/v1`;
};

const resolvePageBackend = (pageUrl: URL | null): string => {
  if (!pageUrl || (pageUrl.protocol !== "http:" && pageUrl.protocol !== "https:")) {
    throw new RuntimeConfigurationError(
      "No supported backend endpoint was provided. Serve Lotus Next over HTTP(S) or inject a trusted Bodhi sidecar port.",
    );
  }
  return `${pageUrl.origin}/v1`;
};

export const resolveBrowserRuntimeConfig = (input: BrowserRuntimeInput = {}): RuntimeConfig => {
  const locationInput = input.location === undefined
    ? (typeof globalThis.location?.href === "string" ? { href: globalThis.location.href } : null)
    : input.location;
  const storage = input.storage === undefined
    ? getDefaultStorage()
    : input.storage;
  const tauriInternals = input.tauriInternals === undefined
    ? (typeof window === "undefined"
        ? undefined
        : (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__)
    : input.tauriInternals;
  const sidecarPort = input.sidecarPort === undefined
    ? (typeof window === "undefined"
        ? undefined
        : (window as unknown as Record<string, unknown>).__BAMBOO_BACKEND_PORT__)
    : input.sidecarPort;
  const embedded = input.embedded ??
    (typeof window !== "undefined" && window.parent !== window);
  const resolvedInput = { ...input, tauriInternals, sidecarPort, embedded };
  const pageUrl = parsePageUrl(locationInput);
  const warn = input.warn ?? ((message: string) => console.warn(`[runtime] ${message}`));

  const sidecarBackend = resolveSidecarBackend(resolvedInput, pageUrl);
  const storedBackend = sidecarBackend ? null : readStoredOverride(storage, pageUrl, warn);
  let buildBackend: string | null = null;
  if (!sidecarBackend && !storedBackend && input.build?.backendBaseUrl?.trim()) {
    buildBackend = assertSafeForPage(input.build.backendBaseUrl, pageUrl);
  }

  let endpointSource: RuntimeEndpointSource;
  let backendBaseUrl: string;
  if (sidecarBackend) {
    endpointSource = "tauri-sidecar";
    backendBaseUrl = sidecarBackend;
  } else if (storedBackend) {
    endpointSource = "stored-override";
    backendBaseUrl = storedBackend;
  } else if (buildBackend) {
    endpointSource = "public-build-default";
    backendBaseUrl = buildBackend;
  } else {
    endpointSource = "page-origin";
    backendBaseUrl = resolvePageBackend(pageUrl);
  }

  return createRuntimeConfig({
    host: resolveHost(resolvedInput, pageUrl),
    endpointSource,
    backendBaseUrl,
    mode: input.build?.mode,
    development: input.build?.development,
    version: input.build?.version,
    revision: input.build?.revision,
  });
};

/** The only production owner of Vite-exposed runtime/build metadata. */
export const resolveDefaultBrowserRuntimeConfig = (): RuntimeConfig =>
  resolveBrowserRuntimeConfig({
    build: {
      backendBaseUrl: import.meta.env.VITE_BACKEND_BASE_URL,
      version: import.meta.env.VITE_APP_VERSION,
      revision: import.meta.env.VITE_APP_REVISION,
      mode: import.meta.env.MODE,
      development: import.meta.env.DEV,
    },
  });

export const persistBackendOverride = (value: string): void => {
  const runtime = getRuntimeConfig();
  if (runtime.host.capabilities.sidecarBackend) {
    throw new RuntimeConfigurationError("Bodhi owns its sidecar endpoint; a browser override is not applicable.");
  }
  const pageUrl = parsePageUrl(
    typeof globalThis.location?.href === "string" ? { href: globalThis.location.href } : null,
  );
  const normalized = assertSafeForPage(value, pageUrl);
  globalThis.localStorage.setItem(BACKEND_OVERRIDE_STORAGE_KEY, normalized);
};

export const clearBackendOverride = (): void => {
  globalThis.localStorage.removeItem(BACKEND_OVERRIDE_STORAGE_KEY);
};

export const hasBackendOverride = (): boolean =>
  globalThis.localStorage.getItem(BACKEND_OVERRIDE_STORAGE_KEY) !== null;

declare global {
  interface Window {
    __BAMBOO_BACKEND_PORT__?: number;
    __TAURI_INTERNALS__?: unknown;
  }
}
