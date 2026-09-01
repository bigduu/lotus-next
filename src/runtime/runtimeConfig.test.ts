import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BACKEND_OVERRIDE_STORAGE_KEY,
  resolveBrowserRuntimeConfig,
  type RuntimeStorage,
} from "./browserRuntime";
import {
  __resetRuntimeConfigForTests,
  createRuntimeConfig,
  createRuntimeEndpointSet,
  getRuntimeConfig,
  installRuntimeConfig,
  RuntimeConfigurationError,
  type RuntimeHost,
} from "./runtimeConfig";

const browserHost: RuntimeHost = {
  kind: "browser",
  capabilities: {
    nativeFileSystem: false,
    nativeNotifications: false,
    externalShell: false,
    sidecarBackend: false,
  },
};

const createMemoryStorage = (): RuntimeStorage & { values: Map<string, string> } => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};

const loopbackEndpointCases = [
  ["IPv4 127/8", "https://127.0.0.2:9443/v1"],
  ["localhost with a trailing dot", "https://localhost.:9443/v1"],
  ["a localhost subdomain", "https://api.dev.localhost:9443/v1"],
  ["IPv4-mapped IPv6", "https://[::ffff:7f00:1]:9443/v1"],
] as const;

const remoteEndpointCases = [
  ["a nearby non-loopback IPv4 address", "https://126.255.255.255:9443/v1/"],
  ["the IPv4 address immediately above 127/8", "https://128.0.0.1:9443/v1/"],
  ["a DNS name containing localhost", "https://localhost.example:9443/v1/"],
  ["a regular IPv6 address", "https://[2001:db8::1]:9443/v1/"],
] as const;

const loopbackPageCases = [
  ["IPv4 127/8", "https://127.0.0.2:7443/app", "https://127.255.255.254:9443/v1"],
  ["localhost with a trailing dot", "https://localhost.:7443/app", "https://localhost:9443/v1"],
  ["a localhost subdomain", "https://ui.dev.localhost:7443/app", "https://api.localhost:9443/v1"],
  ["IPv4-mapped IPv6", "https://[::ffff:7f00:2]:7443/app", "https://[::ffff:7f00:1]:9443/v1"],
] as const;

describe("canonical runtime configuration", () => {
  beforeEach(() => {
    __resetRuntimeConfigForTests();
  });

  afterEach(() => {
    __resetRuntimeConfigForTests();
    vi.unstubAllGlobals();
  });

  it.each([
    ["http://localhost:9562/v1", "http://localhost:9562/v1", "ws://localhost:9562/v2/stream"],
    [
      "https://remote.example:9443/v1/",
      "https://remote.example:9443/v1",
      "wss://remote.example:9443/v2/stream",
    ],
    ["http://127.0.0.1:8080", "http://127.0.0.1:8080/v1", "ws://127.0.0.1:8080/v2/stream"],
  ])("derives one HTTP and WebSocket endpoint set from %s", (input, standardApi, v2Stream) => {
    const endpoints = createRuntimeEndpointSet(input);

    expect(endpoints.standardApi).toBe(standardApi);
    expect(endpoints.agentApi).toBe(`${endpoints.origin}/api/v1`);
    expect(endpoints.v2Stream).toBe(v2Stream);
  });

  it.each([
    "not a URL",
    "ftp://example.com/v1",
    "https://user:password@example.com/v1",
    "https://example.com/v1?token=secret",
    "https://example.com/v1#fragment",
    "https://example.com/proxy/v1",
  ])("rejects a non-canonical endpoint %s", (input) => {
    expect(() => createRuntimeEndpointSet(input)).toThrow(RuntimeConfigurationError);
  });

  it("preserves the exact standalone page origin and explicit port", () => {
    const runtime = resolveBrowserRuntimeConfig({
      location: { href: "http://localhost:9563/chat" },
      storage: createMemoryStorage(),
    });

    expect(runtime.endpoints).toEqual({
      origin: "http://localhost:9563",
      standardApi: "http://localhost:9563/v1",
      agentApi: "http://localhost:9563/api/v1",
      v2Stream: "ws://localhost:9563/v2/stream",
    });
    expect(runtime.endpointSource).toBe("page-origin");
  });

  it("preserves remote HTTPS/WSS on a non-default page port", () => {
    const runtime = resolveBrowserRuntimeConfig({
      location: { href: "https://lotus.example:8443/conversations" },
      storage: createMemoryStorage(),
    });

    expect(runtime.endpoints.standardApi).toBe("https://lotus.example:8443/v1");
    expect(runtime.endpoints.v2Stream).toBe("wss://lotus.example:8443/v2/stream");
  });

  it("gives a trusted Bodhi sidecar port highest priority", () => {
    const storage = createMemoryStorage();
    storage.setItem(BACKEND_OVERRIDE_STORAGE_KEY, "https://stored.example/v1");

    const runtime = resolveBrowserRuntimeConfig({
      location: { href: "tauri://localhost/" },
      storage,
      tauriInternals: { invoke: vi.fn() },
      sidecarPort: 18_432,
      build: { backendBaseUrl: "https://build.example/v1" },
    });

    expect(runtime.host.kind).toBe("bodhi-desktop");
    expect(runtime.host.capabilities.sidecarBackend).toBe(true);
    expect(runtime.endpoints.standardApi).toBe("http://127.0.0.1:18432/v1");
    expect(runtime.endpointSource).toBe("tauri-sidecar");
  });

  it("fails closed when an HTTPS desktop page injects an HTTP sidecar", () => {
    expect(() =>
      resolveBrowserRuntimeConfig({
        location: { href: "https://tauri.localhost/" },
        storage: createMemoryStorage(),
        tauriInternals: { invoke: vi.fn() },
        sidecarPort: 18_432,
      }),
    ).toThrow("cannot connect to an HTTP Bodhi sidecar");
  });

  it.each(["http://remote.example/app", "https://remote.example/app"])(
    "rejects forged sidecar evidence from a remotely served page at %s",
    (href) => {
      expect(() =>
        resolveBrowserRuntimeConfig({
          location: { href },
          storage: null,
          tauriInternals: { invoke: vi.fn() },
          sidecarPort: 18_432,
        }),
      ).toThrow("cannot accept a loopback Bodhi sidecar injection");
    },
  );

  it("does not grant native capabilities from forged Tauri evidence on a remote page", () => {
    const runtime = resolveBrowserRuntimeConfig({
      location: { href: "https://remote.example/app" },
      storage: null,
      tauriInternals: { invoke: vi.fn() },
      sidecarPort: null,
    });

    expect(runtime.host).toEqual(browserHost);
    expect(runtime.endpointSource).toBe("page-origin");
  });

  it("ignores a sidecar port without a callable Tauri runtime", () => {
    const runtime = resolveBrowserRuntimeConfig({
      location: { href: "http://localhost:7310/" },
      storage: createMemoryStorage(),
      tauriInternals: {},
      sidecarPort: 19_999,
    });

    expect(runtime.host.kind).toBe("browser");
    expect(runtime.endpoints.standardApi).toBe("http://localhost:7310/v1");
  });

  it("treats an explicit null location as disabling ambient page discovery", () => {
    vi.stubGlobal("location", { href: "https://ambient.example/app" });

    expect(() =>
      resolveBrowserRuntimeConfig({
        location: null,
        storage: null,
        tauriInternals: null,
        sidecarPort: null,
      }),
    ).toThrow("No supported backend endpoint was provided");
  });

  it("treats explicit null Tauri internals as disabling ambient host discovery", () => {
    const ambientWindow = {
      __TAURI_INTERNALS__: { invoke: vi.fn() },
      __BAMBOO_BACKEND_PORT__: 18_432,
    } as Record<string, unknown> & { parent?: unknown };
    ambientWindow.parent = ambientWindow;
    vi.stubGlobal("window", ambientWindow);

    const runtime = resolveBrowserRuntimeConfig({
      location: { href: "http://localhost:7310/app" },
      storage: null,
      tauriInternals: null,
      sidecarPort: 19_999,
    });

    expect(runtime.host.kind).toBe("browser");
    expect(runtime.endpointSource).toBe("page-origin");
    expect(runtime.endpoints.standardApi).toBe("http://localhost:7310/v1");
  });

  it("treats an explicit null sidecar port as disabling ambient port discovery", () => {
    const ambientWindow = {
      __BAMBOO_BACKEND_PORT__: 18_432,
    } as Record<string, unknown> & { parent?: unknown };
    ambientWindow.parent = ambientWindow;
    vi.stubGlobal("window", ambientWindow);

    const runtime = resolveBrowserRuntimeConfig({
      location: { href: "tauri://localhost/app" },
      storage: null,
      tauriInternals: { invoke: vi.fn() },
      sidecarPort: null,
      build: { backendBaseUrl: "https://build.example:7443/v1" },
    });

    expect(runtime.host.kind).toBe("bodhi-desktop");
    expect(runtime.endpointSource).toBe("public-build-default");
    expect(runtime.endpoints.standardApi).toBe("https://build.example:7443/v1");
  });

  it("prefers a safe stored override over the public build default and page origin", () => {
    const storage = createMemoryStorage();
    storage.setItem(BACKEND_OVERRIDE_STORAGE_KEY, "https://stored.example:9443/v1/");

    const runtime = resolveBrowserRuntimeConfig({
      location: { href: "https://page.example:8443/" },
      storage,
      build: { backendBaseUrl: "https://build.example/v1" },
    });

    expect(runtime.endpoints.standardApi).toBe("https://stored.example:9443/v1");
    expect(runtime.endpointSource).toBe("stored-override");
  });

  it.each(remoteEndpointCases)("preserves stored override for %s", (_description, endpoint) => {
    const storage = createMemoryStorage();
    storage.setItem(BACKEND_OVERRIDE_STORAGE_KEY, endpoint);

    const runtime = resolveBrowserRuntimeConfig({
      location: { href: "https://page.example/app" },
      storage,
    });

    expect(runtime.endpoints.standardApi).toBe(endpoint.replace(/\/$/, ""));
    expect(runtime.endpointSource).toBe("stored-override");
    expect(storage.getItem(BACKEND_OVERRIDE_STORAGE_KEY)).toBe(endpoint);
  });

  it.each(loopbackPageCases)(
    "allows a loopback stored override on a %s page",
    (_description, pageHref, endpoint) => {
      const storage = createMemoryStorage();
      storage.setItem(BACKEND_OVERRIDE_STORAGE_KEY, endpoint);

      const runtime = resolveBrowserRuntimeConfig({
        location: { href: pageHref },
        storage,
      });

      expect(runtime.endpoints.standardApi).toBe(endpoint);
      expect(runtime.endpointSource).toBe("stored-override");
    },
  );

  it("prefers a safe public build default over the page origin", () => {
    const runtime = resolveBrowserRuntimeConfig({
      location: { href: "https://page.example:8443/" },
      storage: createMemoryStorage(),
      build: { backendBaseUrl: "https://build.example:7443/v1" },
    });

    expect(runtime.endpoints.standardApi).toBe("https://build.example:7443/v1");
    expect(runtime.endpointSource).toBe("public-build-default");
  });

  it.each(remoteEndpointCases)("preserves public build default for %s", (_description, endpoint) => {
    const runtime = resolveBrowserRuntimeConfig({
      location: { href: "https://page.example/app" },
      storage: createMemoryStorage(),
      build: { backendBaseUrl: endpoint },
    });

    expect(runtime.endpoints.standardApi).toBe(endpoint.replace(/\/$/, ""));
    expect(runtime.endpointSource).toBe("public-build-default");
  });

  it.each([
    ["not-a-url", "https://page.example/v1"],
    ["http://page.example:9562/v1", "https://page.example/v1"],
    ["https://127.0.0.1:9562/v1", "https://page.example/v1"],
    ["https://user:secret@backend.example/v1", "https://page.example/v1"],
    ["https://backend.example/v1?access_token=secret", "https://page.example/v1"],
  ])("removes unsafe stored override %s and uses the page origin", (stored, expected) => {
    const storage = createMemoryStorage();
    storage.setItem(BACKEND_OVERRIDE_STORAGE_KEY, stored);
    const warn = vi.fn();

    const runtime = resolveBrowserRuntimeConfig({
      location: { href: "https://page.example/" },
      storage,
      warn,
    });

    expect(runtime.endpoints.standardApi).toBe(expected);
    expect(storage.getItem(BACKEND_OVERRIDE_STORAGE_KEY)).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it.each(loopbackEndpointCases)(
    "removes stored override targeting %s from a remote page",
    (_description, endpoint) => {
      const storage = createMemoryStorage();
      storage.setItem(BACKEND_OVERRIDE_STORAGE_KEY, endpoint);
      const warn = vi.fn();

      const runtime = resolveBrowserRuntimeConfig({
        location: { href: "https://page.example/app" },
        storage,
        warn,
      });

      expect(runtime.endpoints.standardApi).toBe("https://page.example/v1");
      expect(runtime.endpointSource).toBe("page-origin");
      expect(storage.getItem(BACKEND_OVERRIDE_STORAGE_KEY)).toBeNull();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("cannot target a loopback backend"),
      );
    },
  );

  it("fails closed on an unsafe public build endpoint", () => {
    expect(() =>
      resolveBrowserRuntimeConfig({
        location: { href: "https://remote.example/" },
        storage: createMemoryStorage(),
        build: { backendBaseUrl: "http://127.0.0.1:9562/v1" },
      }),
    ).toThrow("cannot use an insecure HTTP backend");
  });

  it.each(loopbackEndpointCases)(
    "fails closed when the public build default targets %s from a remote page",
    (_description, endpoint) => {
      expect(() =>
        resolveBrowserRuntimeConfig({
          location: { href: "https://page.example/app" },
          storage: createMemoryStorage(),
          build: { backendBaseUrl: endpoint },
        }),
      ).toThrow("cannot target a loopback backend");
    },
  );

  it("does not probe health or guess loopback when resolving a remote page", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const runtime = resolveBrowserRuntimeConfig({
      location: { href: "http://mac.local:1420/chat" },
      storage: createMemoryStorage(),
    });

    expect(runtime.endpoints.standardApi).toBe("http://mac.local:1420/v1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails visibly when neither HTTP(S) page origin nor trusted sidecar exists", () => {
    expect(() =>
      resolveBrowserRuntimeConfig({
        location: { href: "file:///Applications/Lotus/index.html" },
        storage: createMemoryStorage(),
      }),
    ).toThrow("No supported backend endpoint was provided");
  });

  it("records embedded host capabilities without creating a product fork", () => {
    const runtime = resolveBrowserRuntimeConfig({
      location: { href: "https://bamboo.example/lotus/" },
      storage: createMemoryStorage(),
      embedded: true,
    });

    expect(runtime.host).toEqual({
      kind: "bamboo-embedded",
      capabilities: {
        nativeFileSystem: false,
        nativeNotifications: false,
        externalShell: false,
        sidecarBackend: false,
      },
    });
  });

  it("keeps public metadata, artifact identity, and cookie auth isolated", () => {
    const runtime = resolveBrowserRuntimeConfig({
      location: { href: "https://lotus.example/" },
      storage: createMemoryStorage(),
      build: {
        mode: "staging",
        development: false,
        version: "2.1.0",
        revision: "sha-abc123",
      },
    });

    expect(runtime.publicMetadata).toEqual({
      mode: "staging",
      development: false,
    });
    expect(runtime.artifact).toEqual({
      packageName: "@bigduu/lotus-next",
      version: "2.1.0",
      revision: "sha-abc123",
    });
    expect(runtime.auth).toEqual({ source: "http-cookie", requestCredentials: "include" });
    expect(runtime.schemaVersion).toBe(1);
    expect(runtime.publicMetadata).not.toHaveProperty("token");
    expect(runtime.publicMetadata).not.toHaveProperty("credentials");
  });

  it("recursively freezes one runtime and permits an identical reinstall", () => {
    const runtime = createRuntimeConfig({
      host: browserHost,
      endpointSource: "page-origin",
      backendBaseUrl: "https://lotus.example:9443/v1",
    });

    expect(installRuntimeConfig(runtime)).toBe(runtime);
    expect(installRuntimeConfig(runtime)).toBe(runtime);
    expect(getRuntimeConfig()).toBe(runtime);
    expect(Object.isFrozen(runtime)).toBe(true);
    expect(Object.isFrozen(runtime.endpoints)).toBe(true);
    expect(Object.isFrozen(runtime.host.capabilities)).toBe(true);
  });

  it("fails closed when a different runtime is installed twice", () => {
    installRuntimeConfig(
      createRuntimeConfig({
        host: browserHost,
        endpointSource: "page-origin",
        backendBaseUrl: "https://one.example/v1",
      }),
    );

    expect(() =>
      installRuntimeConfig(
        createRuntimeConfig({
          host: browserHost,
          endpointSource: "page-origin",
          backendBaseUrl: "https://two.example/v1",
        }),
      ),
    ).toThrow("A different Lotus Next runtime is already installed");
  });

  it("rejects service access before composition-root installation", () => {
    expect(() => getRuntimeConfig()).toThrow("composition root must install it");
  });
});
