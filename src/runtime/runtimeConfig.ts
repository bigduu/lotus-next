export type RuntimeHostKind = "browser" | "bamboo-embedded" | "bodhi-desktop";
export type RuntimeEndpointSource =
  | "tauri-sidecar"
  | "stored-override"
  | "public-build-default"
  | "page-origin";

export interface RuntimeHostCapabilities {
  readonly nativeFileSystem: boolean;
  readonly nativeNotifications: boolean;
  readonly externalShell: boolean;
  readonly sidecarBackend: boolean;
}

export interface RuntimeHost {
  readonly kind: RuntimeHostKind;
  readonly capabilities: RuntimeHostCapabilities;
}

export interface RuntimeEndpointSet {
  readonly origin: string;
  readonly standardApi: string;
  readonly agentApi: string;
  readonly v2Stream: string;
}

export interface PublicRuntimeMetadata {
  readonly mode: string;
  readonly development: boolean;
}

export interface RuntimeArtifactIdentity {
  readonly packageName: "@bigduu/lotus-next";
  readonly version: string;
  readonly revision: string | null;
}

/**
 * Authentication policy is deliberately separate from public build metadata.
 * This schema records only the currently implemented same-site-cookie boundary;
 * it does not claim remote/mobile device-token pairing support and never accepts
 * a token, password, or API key from Vite build variables. Secure device
 * credential provisioning/storage/rotation/revocation and authenticated WSS
 * hello negotiation belong to a future coordinated Lotus/Bamboo/Bodhi slice.
 */
export interface RuntimeAuthAccess {
  readonly source: "http-cookie";
  readonly requestCredentials: "include";
}

export interface RuntimeConfig {
  readonly schemaVersion: 1;
  readonly host: RuntimeHost;
  readonly endpointSource: RuntimeEndpointSource;
  readonly endpoints: RuntimeEndpointSet;
  readonly publicMetadata: PublicRuntimeMetadata;
  readonly artifact: RuntimeArtifactIdentity;
  readonly auth: RuntimeAuthAccess;
}

export class RuntimeConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeConfigurationError";
  }
}

const normalizeOptionalText = (value: string | null | undefined): string | null => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

/**
 * Parse one canonical backend base and derive every transport endpoint from
 * the same origin. Deployments with a path prefix require an explicit future
 * protocol contract; silently accepting arbitrary paths would make HTTP and
 * WebSocket ownership diverge again.
 */
export const createRuntimeEndpointSet = (backendBaseUrl: string): RuntimeEndpointSet => {
  const trimmed = backendBaseUrl.trim().replace(/\/+$/, "");
  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    throw new RuntimeConfigurationError("Backend endpoint must be an absolute HTTP(S) URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new RuntimeConfigurationError("Backend endpoint must use HTTP or HTTPS.");
  }
  if (parsed.username || parsed.password) {
    throw new RuntimeConfigurationError("Backend endpoint must not contain credentials.");
  }
  if (parsed.search || parsed.hash) {
    throw new RuntimeConfigurationError("Backend endpoint must not contain a query or fragment.");
  }

  const pathname = parsed.pathname.replace(/\/+$/, "");
  if (pathname && pathname !== "/v1") {
    throw new RuntimeConfigurationError("Backend endpoint path must be empty or /v1.");
  }

  const origin = parsed.origin;
  const wsProtocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  return {
    origin,
    standardApi: `${origin}/v1`,
    agentApi: `${origin}/api/v1`,
    v2Stream: `${wsProtocol}//${parsed.host}/v2/stream`,
  };
};

export interface CreateRuntimeConfigInput {
  readonly host: RuntimeHost;
  readonly endpointSource: RuntimeEndpointSource;
  readonly backendBaseUrl: string;
  readonly mode?: string;
  readonly development?: boolean;
  readonly version?: string;
  readonly revision?: string | null;
}

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
};

export const createRuntimeConfig = (input: CreateRuntimeConfigInput): RuntimeConfig =>
  deepFreeze({
    schemaVersion: 1 as const,
    host: {
      kind: input.host.kind,
      capabilities: { ...input.host.capabilities },
    },
    endpointSource: input.endpointSource,
    endpoints: createRuntimeEndpointSet(input.backendBaseUrl),
    publicMetadata: {
      mode: normalizeOptionalText(input.mode) ?? "production",
      development: input.development === true,
    },
    artifact: {
      packageName: "@bigduu/lotus-next" as const,
      version: normalizeOptionalText(input.version) ?? "0.0.0",
      revision: normalizeOptionalText(input.revision),
    },
    auth: {
      source: "http-cookie" as const,
      requestCredentials: "include" as const,
    },
  });

let installedRuntime: RuntimeConfig | null = null;

const runtimeFingerprint = (runtime: RuntimeConfig): string => JSON.stringify(runtime);

/** Install exactly one immutable configuration before application modules load. */
export const installRuntimeConfig = (runtime: RuntimeConfig): RuntimeConfig => {
  if (installedRuntime) {
    if (runtimeFingerprint(installedRuntime) !== runtimeFingerprint(runtime)) {
      throw new RuntimeConfigurationError(
        "A different Lotus Next runtime is already installed; reload the complete artifact instead.",
      );
    }
    return installedRuntime;
  }

  installedRuntime = deepFreeze(runtime);
  return installedRuntime;
};

export const getRuntimeConfig = (): RuntimeConfig => {
  if (!installedRuntime) {
    throw new RuntimeConfigurationError(
      "Lotus Next runtime is not installed. The composition root must install it before loading application services.",
    );
  }
  return installedRuntime;
};

/** Test-only reset; production bootstrap never replaces an installed runtime. */
export const __resetRuntimeConfigForTests = (): void => {
  installedRuntime = null;
};
