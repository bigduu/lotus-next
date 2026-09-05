import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildInventory,
  compareInventory,
  findArchitectureViolations,
  verifyBootstrapOrder,
  verifyRepositoryArchitecture,
} from "./check-architecture.mjs";

const fixtureMessages = (file, source) =>
  findArchitectureViolations(new Map([[file, source]])).join("\n");
const runtimeSchema = (body = "") =>
  `interface RuntimeEndpointSet { readonly origin: string; readonly nativeApi: string; readonly v2Stream: string } ${body}`;
const clientOwner = (member = "", tail = "") =>
  `export class ApiClient { ${member} } ${tail}`;
const transportOwner = (member = "", tail = "") =>
  `export class HttpTransport { ${member} } const canonical = new HttpTransport({}); const fetchOwner = globalThis.fetch; ${tail}`;

describe("architecture boundary fixtures", () => {
  it("allows the designated runtime, composition, and transport adapters", () => {
    const sources = new Map([
      [
        "src/runtime/browserRuntime.ts",
        `
          const base = import.meta.env.VITE_BACKEND_BASE_URL;
          const key = "lotus_next_backend_endpoint_v1";
          const legacyKey = "copilot_backend_base_url";
          const legacyPath = parsed.pathname === "/v1";
          const port = window.__BAMBOO_BACKEND_PORT__;
          const tauri = window.__TAURI_INTERNALS__;
        `,
      ],
      ["src/runtime/runtimeConfig.ts", runtimeSchema()],
      [
        "src/services/api/transport.ts",
        `
          class HttpTransport {}
          const createBrowserHttpTransport = () =>
            new HttpTransport({ fetchImplementation: globalThis.fetch.bind(globalThis) });
        `,
      ],
      ["src/services/api/client.ts", `class ApiClient { transport: HttpTransport; }`],
      [
        "src/services/api/index.ts",
        `
          import { ApiClient } from "./client";
          import { createBrowserHttpTransport } from "./transport";
          const runtime = getRuntimeConfig();
          const transport = createBrowserHttpTransport();
          const apiClient = new ApiClient({ baseUrl: runtime.endpoints.nativeApi, transport });
        `,
      ],
      [
        "src/services/chat/v2Stream.ts",
        `const endpoint = getRuntimeConfig().endpoints.v2Stream; new WebSocket(endpoint);`,
      ],
    ]);

    expect(findArchitectureViolations(sources)).toEqual([]);
  });

  it("rejects endpoint, host, and transport access from feature code", () => {
    const sources = new Map([
      [
        "src/features/chat/unsafe.ts",
        `
          const endpoint = import.meta.env.VITE_BACKEND_BASE_URL;
          localStorage.getItem("copilot_backend_base_url");
          const tauri = window.__TAURI__;
          fetch(endpoint);
          new XMLHttpRequest();
          new WebSocket(endpoint);
          new ApiClient({ baseUrl: endpoint });
          getRuntimeConfig().endpoints.agentApi;
        `,
      ],
    ]);

    const violations = findArchitectureViolations(sources).join("\n");
    expect(violations).toMatch(/endpoint-related import\.meta\.env/);
    expect(violations).toMatch(/backend override storage/);
    expect(violations).toMatch(/concrete Tauri access/);
    expect(violations).toMatch(/second HTTP transport owner/);
    expect(violations).toMatch(/alternate HTTP\/SSE client/);
    expect(violations).toMatch(/WebSocket access is outside/);
    expect(violations).toMatch(/ApiClient construction is owned/);
    expect(violations).toMatch(/runtime endpoints are consumed outside/);
  });

  it("rejects remote backend literals and direct origin composition from feature code", () => {
    const sources = new Map([
      [
        "src/features/chat/unsafe.ts",
        `
          const standard = "https://backend.example:9443/v1";
          const agent = "https://backend.example/api/v1";
          const stream = "wss://stream.example/v2/stream";
          const lan = "http://192.168.1.50:9562/v1";
          const concatenated = window.location.origin + "/api/v1";
          const constructed = new URL("/v2/stream", window.location.origin);
        `,
      ],
    ]);

    const violations = findArchitectureViolations(sources).filter((message) =>
      message.includes("raw backend endpoint"),
    );
    expect(violations).toHaveLength(6);
  });

  it("allows only exact frozen provider endpoint debt in its named owners", () => {
    const allowed = new Map([
      ["src/lib/providerPresets.ts", `const endpoint = "https://api.deepseek.com/v1";`],
    ]);
    const changed = new Map([
      ["src/lib/providerPresets.ts", `const endpoint = "https://backend.example/v1";`],
    ]);

    expect(findArchitectureViolations(allowed)).toEqual([]);
    expect(findArchitectureViolations(changed).join("\n")).toMatch(/raw backend endpoint/);
  });

  it.each([
    ["extra field", "src/runtime/runtimeConfig.ts", `interface RuntimeEndpointSet { readonly origin: string; readonly nativeApi: string; readonly legacyNativeApi: string; readonly v2Stream: string }`, /expose exactly/],
    ["duplicate field", "src/runtime/runtimeConfig.ts", `interface RuntimeEndpointSet { readonly origin: string; readonly nativeApi: string; readonly nativeApi: string }`, /expose exactly/],
    ["missing fields", "src/runtime/runtimeConfig.ts", `interface RuntimeEndpointSet { readonly origin: string; readonly origin: string; readonly origin: string }`, /expose exactly/],
    ["optional field", "src/runtime/runtimeConfig.ts", `interface RuntimeEndpointSet { readonly origin: string; readonly nativeApi?: string; readonly v2Stream: string }`, /expose exactly/],
    ["mutable field", "src/runtime/runtimeConfig.ts", `interface RuntimeEndpointSet { origin: string; readonly nativeApi: string; readonly v2Stream: string }`, /expose exactly/],
    ["non-string field", "src/runtime/runtimeConfig.ts", `interface RuntimeEndpointSet { readonly origin: string; readonly nativeApi: unknown; readonly v2Stream: string }`, /expose exactly/],
    ["inheritance", "src/runtime/runtimeConfig.ts", `interface Extra { mirrorApi: string } interface RuntimeEndpointSet extends Extra { readonly origin: string; readonly nativeApi: string; readonly v2Stream: string }`, /must not extend/],
    ["augmentation", "src/features/chat/unsafe.ts", `export {}; declare module "@/runtime/runtimeConfig" { interface RuntimeEndpointSet { mirrorApi?: string } }`, /augmentation and shadow schemas/],
  ])("rejects RuntimeEndpointSet %s", (_label, file, source, expected) => {
    expect(fixtureMessages(file, source)).toMatch(expected);
  });

  it("rejects deprecated dual-client names and duplicate canonical composition", () => {
    const deprecated = fixtureMessages(
      "src/features/chat/unsafe.ts",
      `const standardApi = endpoint; const agentApi = endpoint; const agentApiClient = apiClient;`,
    );
    for (const name of ["standardApi", "agentApi", "agentApiClient"]) {
      expect(deprecated).toMatch(new RegExp(`deprecated native REST name ${name}`));
    }
    const duplicate = fixtureMessages("src/services/api/index.ts", `
      import { ApiClient } from "./client"; import { createBrowserHttpTransport } from "./transport";
      const runtime = getRuntimeConfig(); const transport = createBrowserHttpTransport();
      new ApiClient({ baseUrl: runtime.endpoints.nativeApi, transport });
      new ApiClient({ baseUrl: runtime.endpoints.nativeApi, transport });`);
    expect(duplicate).toMatch(/must construct exactly one native ApiClient/);
    expect(duplicate).toMatch(/must read exactly one native runtime endpoint/);
  });

  it("rejects retired provider configuration endpoints without blocking instance contracts", () => {
    const retired = new Map([
      [
        "src/services/config/unsafe.ts",
        `
          apiClient.get("/bamboo/settings/provider");
          apiClient.post("/bamboo/settings/provider", {});
          apiClient.post("/bamboo/settings/provider/models", {});
        `,
      ],
    ]);
    const canonical = new Map([
      [
        "src/services/config/safe.ts",
        `
          apiClient.get("/bamboo/settings/provider-instances");
          apiClient.post("/bamboo/settings/provider-instances/default", {});
          apiClient.get("/bamboo/provider-catalog");
          apiClient.post("/bamboo/provider-catalog/fetch-models", {});
        `,
      ],
    ]);

    expect(
      findArchitectureViolations(retired).filter((message) =>
        message.includes("retired provider endpoint"),
      ),
    ).toHaveLength(3);
    expect(findArchitectureViolations(canonical)).toEqual([]);
  });

  it("keeps Notification Channels off the whole-config endpoint", () => {
    const owners = [
      "src/components/chat/settings/SettingsNotifications.tsx",
      "src/components/chat/settings/notifications/ChannelsSection.tsx",
      "src/components/chat/settings/notifications/notificationConfigHelper.ts",
      "src/services/notification/notificationChannelsApi.ts",
    ];
    for (const file of owners) {
      const violations = fixtureMessages(
        file,
        `
          const wholeConfig = ["bamboo", "config"].join("/");
          apiClient.get(wholeConfig);
          apiClient.post("/api/v1/bamboo/config", {});
        `,
      );
      expect(violations.match(/Notification Channels must use the dedicated/g)).toHaveLength(2);
    }
  });

  it("blocks whole-config facades throughout the Notification Channels subtree", () => {
    const violations = fixtureMessages(
      "src/components/chat/settings/notifications/notificationConfigHelper.ts",
      `
        import { serviceFactory } from "@services/common/ServiceFactory";
        import { useBambooConfigStore } from "@shared/store/bambooConfigStore";
        serviceFactory.getBambooConfig();
        useBambooConfigStore.getState().patchConfig({});
      `,
    );
    expect(violations).toContain("must not import a whole-config facade or store");
    expect(violations).toContain("must use the dedicated bamboo/config/notifications");
  });

  it("rejects imported or dynamic routes in the dedicated notification service", () => {
    const violations = fixtureMessages(
      "src/services/notification/notificationChannelsApi.ts",
      `
        import { apiClient } from "../api";
        import { ROOT_CONFIG_PATH } from "./rootConfigPath";
        apiClient.get(ROOT_CONFIG_PATH);
        const load = (route) => apiClient.get(route);
      `,
    );
    expect(violations.match(/routes must resolve statically/g)).toHaveLength(2);
    expect(violations).toContain("only its audited local authority dependencies");
  });

  it("freezes notification service transport method, binding, and endpoint pairs", () => {
    const violations = fixtureMessages(
      "src/services/notification/notificationChannelsApi.ts",
      `
        import { apiClient as client } from "../api";
        import ky from "ky";
        apiClient.post("bamboo/config/notifications");
        apiClient.get("bamboo/config/notifications?secret=value");
        const load = apiClient.get;
        void client;
        void ky;
      `,
    );
    expect(violations).toContain("named, unaliased binding");
    expect(violations).toContain("only its audited local authority dependencies");
    expect(violations.match(/routes must resolve statically/g)).toHaveLength(2);
    expect(violations).toContain("only through direct approved calls");
  });

  it("rejects dynamic imports and re-exports outside the notification authority closure", () => {
    const dynamicImport = fixtureMessages(
      "src/components/chat/settings/notifications/ChannelsSection.tsx",
      `
        const legacy = await import("@services/notification/legacyChannels");
        void legacy;
      `,
    );
    const dynamicUnknown = fixtureMessages(
      "src/components/chat/settings/notifications/ChannelsSection.tsx",
      `
        const path = getLegacyPath();
        const legacy = await import(path);
        void legacy;
      `,
    );
    const reexport = fixtureMessages(
      "src/services/notification/notificationChannelsApi.ts",
      `export { loadConfig } from "./legacyChannels";`,
    );
    expect(dynamicImport).toContain("load only its audited local authority dependencies");
    expect(dynamicUnknown).toContain("requires a static approved runtime dependency");
    expect(reexport).toContain("re-export only its audited local authority dependencies");
  });

  it("normalizes alias traversal before checking the notification authority closure", () => {
    const violations = fixtureMessages(
      "src/components/chat/settings/notifications/escape.ts",
      `
        import { useSystemConfig } from "@components/chat/settings/notifications/../system/useSystemConfig";
        export const useEscapedAuthority = () => useSystemConfig();
      `,
    );

    expect(violations).toContain(
      "Notification Channels may import only its audited local authority dependencies",
    );
  });

  it.each(["glob", "globEager"])(
    "rejects import.meta.%s from a notification authority owner",
    (method) => {
      const violations = fixtureMessages(
        "src/components/chat/settings/notifications/ChannelsSection.tsx",
        `
          const modules = import.meta.${method}(
            "/src/components/chat/settings/system/useSystemConfig.ts",
            { eager: true },
          );
          void modules;
        `,
      );

      expect(violations).toContain(
        "import.meta.glob bypasses the Notification Channels authority boundary",
      );
    },
  );

  it("rejects transitive service wrappers and barrel aliases from notification owners", () => {
    const wrapper = fixtureMessages(
      "src/components/chat/settings/notifications/notificationConfigHelper.ts",
      `
        import { loadNotificationConfig } from "@services/notification/rootConfigWrapper";
        loadNotificationConfig();
      `,
    );
    const barrel = fixtureMessages(
      "src/components/chat/settings/SettingsNotifications.tsx",
      `
        import { serviceFactory as config } from "@services";
        config.getBambooConfig();
      `,
    );
    expect(wrapper).toContain("only its audited local authority dependencies");
    expect(barrel).toContain("only its audited local authority dependencies");
    expect(barrel).toContain("must use the dedicated bamboo/config/notifications");
  });

  it("keeps the canonical service and channel component on separate frozen dependency sets", () => {
    const serviceToComponent = fixtureMessages(
      "src/services/notification/notificationChannelsApi.ts",
      `import { loadLegacy } from "@components/chat/settings/notifications/legacyLoader";`,
    );
    const channelToPreferences = fixtureMessages(
      "src/components/chat/settings/notifications/ChannelsSection.tsx",
      `import { getNotificationPreferences } from "@services/notification/notificationPreferencesApi";`,
    );
    expect(serviceToComponent).toContain("only its audited local authority dependencies");
    expect(channelToPreferences).toContain("only its audited local authority dependencies");
  });

  it("freezes trusted notification leaves against transitive runtime authority", () => {
    const violations = findArchitectureViolations(
      new Map([
        [
          "src/components/chat/settings/notifications/ChannelsSection.tsx",
          `import { isMaskedSecret } from "@/lib/secrets"; void isMaskedSecret;`,
        ],
        [
          "src/lib/secrets.ts",
          `
            import { apiClient } from "@services/api";
            export const isMaskedSecret = (value) => {
              void apiClient.get("bamboo/config");
              return Boolean(value);
            };
          `,
        ],
      ]),
    ).join("\n");

    expect(violations).toContain(
      "Notification Channels dependency closure may import only audited pure dependencies",
    );
    expect(violations).toContain(
      "Notification Channels dependency closure must not use runtime authority",
    );
    expect(violations).toContain(
      "Notification Channels must use the dedicated bamboo/config/notifications section contract",
    );
  });

  it("allows the dedicated notification section and scopes the prohibition to its owners", () => {
    expect(
      fixtureMessages(
        "src/services/notification/notificationChannelsApi.ts",
        `
          apiClient.get("bamboo/config/notifications");
          apiClient.put("bamboo/config/notifications", {});
        `,
      ),
    ).toBe("");
    expect(
      fixtureMessages(
        "src/components/chat/settings/SystemSettings.tsx",
        `apiClient.get("bamboo/config");`,
      ),
    ).toBe("");
  });

  it.each([
    ["Api alias", "src/services/api/client.ts", clientOwner("", `const Alias = ApiClient; new Alias({});`)],
    ["Api subclass", "src/services/api/client.ts", clientOwner("", `class Duplicate extends ApiClient {}; new Duplicate({});`)],
    ["Api Reflect", "src/services/api/client.ts", clientOwner("", `Reflect.construct(ApiClient, [{}]);`)],
    ["Api new this", "src/services/api/client.ts", clientOwner(`static duplicate() { return new this(); }`)],
    ["Api Reflect this", "src/services/api/client.ts", clientOwner(`static duplicate() { return Reflect.construct(this, []); }`)],
    ["Api this.constructor", "src/services/api/client.ts", clientOwner(`duplicate() { return new this.constructor(); }`)],
    ["Api dynamic new", "src/services/api/client.ts", clientOwner(`static duplicate(C: typeof ApiClient) { return new C({}); }`)],
    ["Api dynamic Reflect", "src/services/api/client.ts", clientOwner(`static duplicate(C: typeof ApiClient) { return Reflect.construct(C, []); }`)],
    ["transport alias", "src/services/api/transport.ts", transportOwner("", `const Alias = HttpTransport; new Alias({});`)],
    ["transport subclass", "src/services/api/transport.ts", transportOwner("", `class Duplicate extends HttpTransport {}; new Duplicate({});`)],
    ["transport Reflect", "src/services/api/transport.ts", transportOwner("", `Reflect.construct(HttpTransport, [{}]);`)],
    ["transport new this", "src/services/api/transport.ts", transportOwner(`static duplicate() { return new this(); }`)],
    ["transport Reflect this", "src/services/api/transport.ts", transportOwner(`static duplicate() { return Reflect.construct(this, []); }`)],
    ["transport this.constructor", "src/services/api/transport.ts", transportOwner(`duplicate() { return new this.constructor(); }`)],
    ["transport dynamic new", "src/services/api/transport.ts", transportOwner(`static duplicate(C: typeof HttpTransport) { return new C({}); }`)],
    ["transport dynamic Reflect", "src/services/api/transport.ts", transportOwner(`static duplicate(C: typeof HttpTransport) { return Reflect.construct(C, []); }`)],
  ])("rejects concrete owner escape: %s", (_label, file, source) => {
    expect(fixtureMessages(file, source)).toMatch(/definition owner/);
  });

  it("allows definitions, type positions, and the canonical direct transport construction", () => {
    expect(findArchitectureViolations(new Map([
      ["src/services/api/client.ts", clientOwner("", `interface Owner { client: ApiClient }`)],
      ["src/services/api/transport.ts", `export class HttpTransport {} export function create(): HttpTransport { return new HttpTransport({ fetchImplementation: globalThis.fetch }); }`],
    ]))).toEqual([]);
  });

  it("allows named /v1 data/parser exceptions but rejects executable native routes", () => {
    expect(findArchitectureViolations(new Map([
      ["src/runtime/browserRuntime.ts", `const legacy = parsed.pathname === "/v1";`],
      ["vite.config.ts", `if (parsed.pathname === "/v1") throw new Error("unsupported");`],
      ["src/runtime/runtimeConfig.ts", runtimeSchema("const nativeApi = `${origin}/api/v1`; ")],
      ["src/lib/providerPresets.ts", `const endpoint = "https://api.deepseek.com/v1";`],
    ]))).toEqual([]);
    const unsafe = fixtureMessages("src/features/chat/unsafe.ts", `
      const route = "/v1/sessions"; const composed = origin + "/v1";
      apiClient.get("/v1/commands");`);
    expect(unsafe.match(/Lotus native \/v1 routing is legacy-only/g)).toHaveLength(3);
  });

  it.each([
    `const route = "/" + "v1/sessions"; apiClient.get(route);`,
    `const slash = "/"; const version = "v1"; const route = origin + slash + version; apiClient.get(route);`,
    `const version = "v1"; const route = \`${"${origin}"}/${"${version}"}\`; apiClient.get(route);`,
    `const route = "/".concat("v1/sessions"); apiClient.get(route);`,
    `const route = ["", "v1", "sessions"].join("/"); apiClient.get(route);`,
    `const version = ["v", "1"].join(""); const route = origin + "/" + version; apiClient.get(route);`,
  ])("rejects a statically composed native /v1 route", (source) => {
    expect(fixtureMessages("src/features/chat/unsafe.ts", source)).toMatch(/statically composed paths/);
  });

  it("rejects a statically composed second canonical backend endpoint", () => {
    expect(fixtureMessages("src/features/chat/unsafe.ts", `
      const suffix = "/api/" + "v1"; const baseUrl = origin + suffix; void baseUrl;`),
    ).toMatch(/statically composed backend endpoint is outside/);
  });

  it.each([
    `const nativeApi = origin + "/api" + "/v1";`,
    `const nativeApi = origin.concat("/api", "/v1");`,
    `const nativeApi = [origin, "api", "v1"].join("/");`,
  ])("allows canonical runtime endpoint composition", (composition) => {
    expect(fixtureMessages("src/runtime/runtimeConfig.ts", runtimeSchema(composition))).toBe("");
  });

  it("rejects secret-shaped public Vite variables in every owner", () => {
    const sources = new Map([
      ["src/runtime/browserRuntime.ts", "const secret = import.meta.env.VITE_BAMBOO_API_TOKEN;"],
    ]);

    expect(findArchitectureViolations(sources).join("\n")).toMatch(/secret-shaped variable/);
  });

  it("uses the TypeScript AST instead of deleting comment-prefixed executable lines", () => {
    const safeSources = new Map([
      [
        "src/features/chat/documentation.ts",
        `
          // fetch(endpoint)
          // apiClient.get("/v1/sessions")
          const example = "new WebSocket(endpoint)";
          const note = "import.meta.env.VITE_BACKEND_BASE_URL";
          const legacyDocumentation = 'apiClient.get("/v1/sessions")';
        `,
      ],
    ]);
    const unsafeSources = new Map([
      ["src/features/chat/unsafe.ts", `/* transport */ fetch(endpoint);`],
    ]);

    expect(findArchitectureViolations(safeSources)).toEqual([]);
    expect(findArchitectureViolations(unsafeSources).join("\n")).toMatch(
      /second HTTP transport owner/,
    );
  });

  it("rejects transport and ApiClient aliases", () => {
    const sources = new Map([
      [
        "src/features/chat/unsafe.ts",
        `
          import { ApiClient as ImportedClient } from "../../services/api/client";
          const send = globalThis.fetch;
          send(endpoint);
          const Socket = window.WebSocket;
          new Socket(endpoint);
          const Client = (ImportedClient as typeof ImportedClient);
          new Client({ baseUrl: endpoint, requestCredentials: "include" });
          import * as api from "../../services/api";
          const { ApiClient: NamespaceClient } = api;
          new NamespaceClient({ baseUrl: endpoint, requestCredentials: "include" });
        `,
      ],
    ]);

    const violations = findArchitectureViolations(sources).join("\n");
    expect(violations).toMatch(/second HTTP transport owner/);
    expect(violations).toMatch(/WebSocket access is outside/);
    expect(violations).toMatch(/ApiClient construction is owned/);
  });

  it.each([
    ["Api" + "Client", /ApiClient construction is owned/],
    ["Http" + "Transport", /HttpTransport is an infrastructure transport type/],
    ["createBrowser" + "HttpTransport", /createBrowserHttpTransport is a production composition API/],
    ["Web" + "Socket", /WebSocket access is outside/],
  ])("rejects the statically computed concrete owner key %s", (key, expected) => {
    const middle = Math.floor(key.length / 2);
    expect(fixtureMessages("src/features/chat/unsafe.ts", `
      const key = ${JSON.stringify(key.slice(0, middle))} + ${JSON.stringify(key.slice(middle))};
      void registry[key];`)).toMatch(expected);
  });

  it("rejects a statically computed runtime endpoint property", () => {
    expect(fixtureMessages("src/features/chat/unsafe.ts", `
      const key = "end" + "points"; void runtime[key];`)).toMatch(
      /runtime endpoints are consumed outside designated transport adapters/,
    );
  });

  it("rejects ApiClient inheritance and reflective construction outside composition", () => {
    const sources = new Map([
      [
        "src/features/chat/unsafe.ts",
        `
          class RogueClient extends ApiClient {}
          const AnonymousClient = class extends ApiClient {};
          new RogueClient();
          new AnonymousClient();
          Reflect.construct(ApiClient, [{ baseUrl: endpoint }]);
        `,
      ],
    ]);

    const violations = findArchitectureViolations(sources).filter((message) =>
      message.includes("ApiClient construction is owned"),
    );
    expect(violations.length).toBeGreaterThanOrEqual(3);
  });

  it("fails closed on every production Fetch-shaped access outside the owner", () => {
    const domainSources = new Map([
      ["src/domain/cache.ts", `class Cache { fetch(key) { return key; } } cache.fetch(key);`],
    ]);
    const unsafeSources = new Map([
      [
        "src/domain/cache.ts",
        `
          fetch(url);
          const send = globalThis.fetch;
          const { fetch: otherSend } = window;
          const { ["fetch"]: computedSend } = globalThis;
          send(url);
          otherSend(url);
          computedSend(url);
        `,
      ],
    ]);

    expect(findArchitectureViolations(domainSources).join("\n")).toMatch(
      /second HTTP transport owner/,
    );
    expect(buildInventory(domainSources)["fetch-reference"]).toEqual({
      "src/domain/cache.ts": 1,
    });
    expect(findArchitectureViolations(unsafeSources).join("\n")).toMatch(
      /second HTTP transport owner/,
    );
  });

  it("rejects Fetch through static aliases of the browser global", () => {
    const fixtures = [
      [
        "src/features/chat/unsafe.ts",
        `
          const platform = globalThis;
          platform.fetch(endpoint);
        `,
      ],
      [
        "src/features/chat/unsafe.ts",
        `
          const platform = globalThis.window;
          platform.fetch(endpoint);
        `,
      ],
      [
        "src/features/chat/unsafe.ts",
        `
          const { window: destructuredPlatform } = globalThis;
          destructuredPlatform.fetch(endpoint);
        `,
      ],
      [
        "src/features/chat/unsafe.ts",
        `
          let platform = cache;
          platform = globalThis["self"];
          const chained = platform.window;
          chained.fetch(endpoint);
        `,
      ],
      [
        "src/services/api/client.ts",
        `
          const first = window;
          const second = (first as typeof window);
          second["fetch"](endpoint);
        `,
      ],
      [
        "src/features/chat/unsafe.ts",
        `
          let first;
          let second;
          first = second = globalThis;
          first.fetch(endpoint);
        `,
      ],
      [
        "src/features/chat/unsafe.ts",
        `
          const { window: { fetch: send } } = globalThis;
          send(endpoint);
        `,
      ],
      [
        "src/services/api/client.ts",
        `
          const { window: { self: platform } } = globalThis;
          platform.fetch(endpoint);
        `,
      ],
      [
        "src/features/chat/unsafe.ts",
        `
          let platform;
          ({ window: platform } = globalThis);
          platform.fetch(endpoint);
        `,
      ],
      [
        "src/features/chat/unsafe.ts",
        `
          const [platform] = [globalThis];
          platform.fetch(endpoint);
        `,
      ],
      [
        "src/services/api/client.ts",
        `globalThis[(("fetch" as "fetch") satisfies string)!](endpoint);`,
      ],
    ];

    for (const [file, source] of fixtures) {
      const sources = new Map([[file, source]]);
      const violations = findArchitectureViolations(sources).filter((message) =>
        message.includes("second HTTP transport owner"),
      );
      expect(violations, source).toHaveLength(1);
      expect(buildInventory(sources)["fetch-reference"]).toEqual({ [file]: 1 });
    }
  });

  it("rejects reflective, constant-computed, and assignment-pattern Fetch access", () => {
    const fixtures = [
      [
        "src/features/chat/unsafe.ts",
        `
          const send = Reflect.get(globalThis, "fetch");
          send(endpoint);
        `,
      ],
      [
        "src/features/chat/unsafe.ts",
        `
          const key = "fetch" as const;
          globalThis[key](endpoint);
        `,
      ],
      [
        "src/features/chat/unsafe.ts",
        `globalThis["fe" + "tch"](endpoint);`,
      ],
      [
        "src/features/chat/unsafe.ts",
        `
          const fetch = "fe" as const;
          globalThis[fetch + "tch"](endpoint);
        `,
      ],
      [
        "src/features/chat/unsafe.ts",
        "globalThis[`fetch`](endpoint);",
      ],
      [
        "src/features/chat/unsafe.ts",
        `
          const prefix = "fe" as const;
          const key = \`${"${prefix}"}tch\` as const;
          const send = Reflect.get(globalThis, (key satisfies string)!);
          send(endpoint);
        `,
      ],
      [
        "src/features/chat/unsafe.ts",
        `
          const send = globalThis.Reflect.get(globalThis, "fetch");
          send(endpoint);
        `,
      ],
      [
        "src/features/chat/unsafe.ts",
        `
          const reflection = globalThis.Reflect;
          const send = reflection.get(globalThis, "fetch");
          send(endpoint);
        `,
      ],
      [
        "src/features/chat/unsafe.ts",
        `
          const reflectName = "Reflect" as const;
          const method = "get" as const;
          const prefix = "fe" as const;
          const key = \`${"${prefix}"}tch\` as const;
          const send = globalThis[reflectName][method](globalThis, (key satisfies string)!);
          send(endpoint);
        `,
      ],
      [
        "src/features/chat/unsafe.ts",
        `
          const fetch = "fe" as const;
          const send = Reflect.get(globalThis, \`${"${fetch}"}tch\`);
          send(endpoint);
        `,
      ],
      [
        "src/features/chat/unsafe.ts",
        `
          let send;
          ({ fetch: send } = globalThis);
          send(endpoint);
        `,
      ],
      [
        "src/features/chat/unsafe.ts",
        `
          let fetch;
          ({ fetch: fetch } = globalThis);
        `,
      ],
      [
        "src/features/chat/unsafe.ts",
        `
          let fetch;
          ({ fetch: fetch! } = globalThis);
        `,
      ],
      [
        "src/features/chat/unsafe.ts",
        `
          let fetch;
          ({ fetch: fetch = fallback } = globalThis);
        `,
      ],
      [
        "src/features/chat/unsafe.ts",
        `
          let fetch;
          ({ fetch } = globalThis);
        `,
      ],
      [
        "src/features/chat/unsafe.ts",
        `
          const holder = { fetch: undefined };
          ({ fetch: holder.fetch } = globalThis);
        `,
      ],
      [
        "src/features/chat/unsafe.ts",
        `
          const key = "fetch" as const;
          const { [key]: send } = globalThis;
          send(endpoint);
        `,
      ],
      [
        "src/features/chat/unsafe.ts",
        `
          let send;
          ({ platform: { fetch: send } } = holder);
          send(endpoint);
        `,
      ],
      [
        "src/features/chat/unsafe.ts",
        `
          let send;
          for ({ fetch: send } of platforms) {
            send(endpoint);
          }
        `,
      ],
      [
        "src/features/chat/unsafe.ts",
        `
          let send;
          for ({ fetch: send } in platforms) {
            send(endpoint);
          }
        `,
      ],
      [
        "src/features/chat/unsafe.ts",
        `
          let send;
          for ([{ [("fetch" as const satisfies string)!]: send }] of platforms) {
            send(endpoint);
          }
        `,
      ],
      [
        "src/features/chat/unsafe.ts",
        `
          declare const key: string;
          globalThis[key](endpoint);
        `,
      ],
      [
        "src/features/chat/unsafe.ts",
        `
          declare const key: string;
          const platform = globalThis;
          platform[key](endpoint);
        `,
      ],
      [
        "src/features/chat/unsafe.ts",
        `
          declare const key: string;
          const { window: platform } = globalThis;
          platform[key](endpoint);
        `,
      ],
      [
        "src/features/chat/unsafe.ts",
        `
          declare const key: string;
          const { window: { self: platform } } = globalThis;
          platform[key](endpoint);
        `,
      ],
      [
        "src/features/chat/unsafe.ts",
        `
          declare const key: string;
          const [platform] = [globalThis];
          platform[key](endpoint);
        `,
      ],
      [
        "src/features/chat/unsafe.ts",
        `
          declare const key: string;
          let platform;
          ({ window: platform } = globalThis);
          platform[key](endpoint);
        `,
      ],
      [
        "src/features/chat/unsafe.ts",
        `
          declare const key: string;
          let platform;
          [platform] = [globalThis];
          platform[key](endpoint);
        `,
      ],
      [
        "src/features/chat/unsafe.ts",
        `
          declare const key: string;
          let platform;
          for ({ window: platform } of [globalThis]) {
            platform[key](endpoint);
          }
        `,
      ],
      [
        "src/features/chat/unsafe.ts",
        `
          declare const key: string;
          const holder = {};
          const { window: platform = globalThis } = holder;
          platform[key](endpoint);
        `,
      ],
      [
        "src/features/chat/unsafe.ts",
        `
          declare const key: string;
          function usePlatform(platform = globalThis) {
            platform[key](endpoint);
          }
        `,
      ],
      [
        "src/features/chat/unsafe.ts",
        `
          declare const key: string;
          const send = Reflect.get(globalThis, key);
          send(endpoint);
        `,
      ],
      [
        "src/features/chat/unsafe.ts",
        `
          declare const key: string;
          const { Reflect: reflection } = globalThis;
          const send = reflection.get(globalThis, key);
          send(endpoint);
        `,
      ],
      [
        "src/features/chat/unsafe.ts",
        `
          declare const key: string;
          let reflection;
          [reflection] = [globalThis.Reflect];
          const send = reflection.get(globalThis, key);
          send(endpoint);
        `,
      ],
      [
        "src/features/chat/unsafe.ts",
        `
          declare const key: string;
          const { [key]: send } = globalThis;
          send(endpoint);
        `,
      ],
      [
        "src/features/chat/unsafe.ts",
        `
          declare const key: string;
          let send;
          ({ [key]: send } = globalThis);
          send(endpoint);
        `,
      ],
      [
        "src/features/chat/unsafe.ts",
        `
          const fetch = "fe" as const;
          let send;
          ({ [fetch + "tch"]: send } = globalThis);
          send(endpoint);
        `,
      ],
    ];

    for (const [file, source] of fixtures) {
      const sources = new Map([[file, source]]);
      const violations = findArchitectureViolations(sources).filter((message) =>
        message.includes("second HTTP transport owner"),
      );
      expect(violations, source).toHaveLength(1);
      expect(buildInventory(sources)["fetch-reference"]).toEqual({ [file]: 1 });
    }

    const staticallyNonFetchKey = new Map([
      [
        "src/features/chat/safe.ts",
        `
          const key = "postMessage" as const;
          globalThis[key](payload);
          Reflect.get(globalThis, key);
          const { [key]: send } = globalThis;
          const descriptor = { fetch: send };
          const computedDescriptor = { ["fetch"]: send };
          void descriptor;
          void computedDescriptor;

          {
            const shadowedKey = "fetch" as const;
            void shadowedKey;
          }
          {
            const shadowedKey = "postMessage" as const;
            globalThis[shadowedKey](payload);
          }

          {
            const Reflect = { get: () => send };
            Reflect.get(globalThis, "fetch");
          }
          {
            const globalThis = { channel: send };
            const dynamicKey = readKey();
            globalThis[dynamicKey];
          }

          {
            const fetch = "postMessage" as const;
            globalThis[fetch](payload);
            Reflect.get(globalThis, fetch);
            const { [fetch]: safeAlias } = globalThis;
            let assignedAlias;
            ({ [fetch]: assignedAlias } = globalThis);
            const safeDescriptor = { [fetch]: assignedAlias };
            void safeAlias;
            void safeDescriptor;
          }

          {
            const dynamicKey = readKey();
            const domainRecord = { channel: send };
            const { [dynamicKey]: domainValue } = domainRecord;
            let assignedValue;
            ({ [dynamicKey]: assignedValue } = domainRecord);
            for ({ [dynamicKey]: assignedValue } of domainRecords) {
              void assignedValue;
            }
            void domainValue;
          }
        `,
      ],
    ]);
    expect(findArchitectureViolations(staticallyNonFetchKey)).toEqual([]);
    expect(buildInventory(staticallyNonFetchKey)["fetch-reference"]).toBeUndefined();

    const independentDefaultFetch = new Map([
      [
        "src/features/chat/unsafe.ts",
        `
          let value;
          ({ fetch: value = fetch(endpoint) } = globalThis);
        `,
      ],
    ]);
    const defaultViolations = findArchitectureViolations(independentDefaultFetch).filter(
      (message) => message.includes("second HTTP transport owner"),
    );
    expect(defaultViolations).toHaveLength(2);
    expect(buildInventory(independentDefaultFetch)["fetch-reference"]).toEqual({
      "src/features/chat/unsafe.ts": 2,
    });

    const nestedFetchAssignments = [
      `
        let value;
        ({ fetch: { fetch: value } } = globalThis);
      `,
      `
        const key = "fetch" as const;
        let value;
        ({ [key]: { [key]: value } } = globalThis);
      `,
    ];
    for (const source of nestedFetchAssignments) {
      const sources = new Map([["src/features/chat/unsafe.ts", source]]);
      const violations = findArchitectureViolations(sources).filter((message) =>
        message.includes("second HTTP transport owner"),
      );
      expect(violations, source).toHaveLength(2);
      expect(buildInventory(sources)["fetch-reference"]).toEqual({
        "src/features/chat/unsafe.ts": 2,
      });
    }

    const safeConstKeySource = `
      const key = "postMessage" as const;
      globalThis[key](payload);
    `;
    for (const file of [
      "src/features/chat/safe.ts",
      "./src/features/chat/safe.ts",
      "src\\features\\chat\\safe.ts",
    ]) {
      const sources = new Map([[file, safeConstKeySource]]);
      expect(findArchitectureViolations(sources), file).toEqual([]);
      expect(buildInventory(sources)["fetch-reference"], file).toBeUndefined();
    }
  });

  it("rejects every direct Fetch path inside ApiClient", () => {
    const sources = new Map([
      [
        "src/services/api/client.ts",
        `
          const first = fetch(url, options);
          const send = globalThis["fetch"];
          const second = send(url, options);
        `,
      ],
    ]);

    const violations = findArchitectureViolations(sources).filter((message) =>
      message.includes("second HTTP transport owner"),
    );
    expect(violations).toHaveLength(2);
  });

  it("rejects alternate HTTP clients and transport construction outside the owner", () => {
    const sources = new Map([
      [
        "src/features/chat/unsafe.ts",
        `
          import axios from "axios";
          import {
            HttpTransport as RogueTransport,
            createBrowserHttpTransport as createRogueTransport,
          } from "../../services/api/transport";
          const transport = new RogueTransport({ fetchImplementation: globalThis.fetch });
          const second = createRogueTransport();
          const stream = new EventSource(endpoint);
          void axios;
          void transport;
          void second;
          void stream;
        `,
      ],
      [
        "src/services/api/index.ts",
        `
          const shared = createBrowserHttpTransport();
          const duplicate = new HttpTransport({ fetchImplementation: injectedFetch });
        `,
      ],
    ]);

    const violations = findArchitectureViolations(sources).join("\n");
    expect(violations).toMatch(/alternate HTTP\/SSE client/);
    expect(violations).toMatch(/HttpTransport is an infrastructure transport type/);
    expect(violations).toMatch(/HttpTransport construction is owned by/);
    expect(violations).toMatch(/createBrowserHttpTransport is a production composition API/);
    expect(violations).toMatch(/second HTTP transport owner/);
  });

  it("requires the production API client to use the direct browser transport binding", () => {
    const sources = new Map([
      [
        "src/services/api/index.ts",
        `
          import { ApiClient } from "./client";
          import { createBrowserHttpTransport } from "./transport";
          const shared = createBrowserHttpTransport();
          const alternate = { request() {}, requestOnce() {} };
          const apiClient = new ApiClient({
            baseUrl: runtime.endpoints.nativeApi,
            transport: alternate,
          });
        `,
      ],
    ]);

    const violations = findArchitectureViolations(sources).filter((message) =>
      message.includes("must receive the direct createBrowserHttpTransport binding"),
    );
    expect(violations).toHaveLength(1);
  });

  it("rejects non-top-level client composition even when names shadow canonical bindings", () => {
    const shadowDeclarations = [
      `const shared = alternate;`,
      `enum shared { rogue }`,
      `namespace shared { export const request = alternate.request; }`,
    ];

    for (const shadowDeclaration of shadowDeclarations) {
      const sources = new Map([
        [
          "src/services/api/index.ts",
          `
            import { ApiClient } from "./client";
            import { createBrowserHttpTransport } from "./transport";
            const shared = createBrowserHttpTransport();
            {
              ${shadowDeclaration}
              new ApiClient({
                baseUrl: runtime.endpoints.nativeApi,
                transport: shared,
              });
            }
          `,
        ],
      ]);

      const violations = findArchitectureViolations(sources).filter((message) =>
        message.includes("must receive the direct createBrowserHttpTransport binding"),
      );
      expect(violations).toHaveLength(1);
      expect(buildInventory(sources)).toMatchObject({
        "browser-http-transport-composition": { "src/services/api/index.ts": 1 },
        "api-client-constructor": { "src/services/api/index.ts": 1 },
        "runtime-endpoint-read": { "src/services/api/index.ts": 1 },
      });
    }
  });

  it("requires canonical factory and client import provenance", () => {
    const fixtures = [
      {
        source: `
          import { createBrowserHttpTransport } from "./rogueFactory";
          import { ApiClient } from "./rogueClient";
          const shared = createBrowserHttpTransport();
          const apiClient = new ApiClient({
            baseUrl: runtime.endpoints.nativeApi,
            transport: shared,
          });
        `,
        expected: [
          /must import exactly one createBrowserHttpTransport binding directly from \.\/transport/,
          /must import exactly one ApiClient binding directly from \.\/client/,
        ],
      },
      {
        source: `
          import { createBrowserHttpTransport } from "./transport";
          class ApiClient {}
          const shared = createBrowserHttpTransport();
          const apiClient = new ApiClient({
            baseUrl: runtime.endpoints.nativeApi,
            transport: shared,
          });
        `,
        expected: [/must import exactly one ApiClient binding directly from \.\/client/],
      },
    ];

    for (const { source, expected } of fixtures) {
      const sources = new Map([["src/services/api/index.ts", source]]);
      const violations = findArchitectureViolations(sources).join("\n");
      for (const pattern of expected) expect(violations).toMatch(pattern);
      expect(buildInventory(sources)).toMatchObject({
        "browser-http-transport-composition": { "src/services/api/index.ts": 1 },
        "api-client-constructor": { "src/services/api/index.ts": 1 },
        "runtime-endpoint-read": { "src/services/api/index.ts": 1 },
      });
    }
  });

  it("rejects destructured and computed runtime endpoint reads", () => {
    const sources = new Map([
      [
        "src/features/chat/unsafe.ts",
        `
          const { endpoints } = getRuntimeConfig();
          const runtime = getRuntimeConfig();
          const computed = (runtime as ReturnType<typeof getRuntimeConfig>)["endpoints"];
          import { getRuntimeConfig as readConfig, type RuntimeConfig as Config } from "@/runtime/runtimeConfig";
          import * as runtimeModule from "@/runtime/runtimeConfig";
          const importedAlias = readConfig().endpoints;
          const namespaceAlias = runtimeModule.getRuntimeConfig().endpoints;
          const runtimeFactory = () => getRuntimeConfig();
          const factoryAlias = runtimeFactory().endpoints;
          const typedConsumer = (config: Config) => config.endpoints;
        `,
      ],
    ]);

    const violations = findArchitectureViolations(sources).filter((message) =>
      message.includes("runtime endpoints are consumed outside"),
    );
    expect(violations).toHaveLength(6);
  });

  it("rejects computed endpoint env, storage, Tauri, and alternate HTTP access", () => {
    const sources = new Map([
      [
        "src/features/chat/unsafe.ts",
        `
          import ky from "ky";
          import request from "ofetch";
          const endpoint = import.meta.env["VITE_BACKEND_BASE_URL"];
          localStorage["getItem"]("copilot_backend_base_url");
          const tauri = window["__TAURI__"];
          const Xhr = window.XMLHttpRequest;
          new Xhr();
          new globalThis.EventSource(endpoint);
          request(endpoint);
        `,
      ],
    ]);

    const violations = findArchitectureViolations(sources).join("\n");
    expect(violations).toMatch(/endpoint-related import\.meta\.env/);
    expect(violations).toMatch(/backend override storage/);
    expect(violations).toMatch(/concrete Tauri access/);
    expect(violations).toMatch(/alternate HTTP\/SSE client/);
  });

  it("rejects secret-shaped Vite values and second endpoint inputs in env files", () => {
    const sources = new Map([
      [
        ".env.production",
        `
          VITE_BAMBOO_API_TOKEN=public-is-not-secret
          VITE_SECOND_BACKEND_ORIGIN=https://other.example
          VITE_BACKEND_BASE_URL=https://allowed.example
        `,
      ],
    ]);

    const violations = findArchitectureViolations(sources).join("\n");
    expect(violations).toMatch(/secret-shaped variable VITE_BAMBOO_API_TOKEN/);
    expect(violations).toMatch(/second public endpoint input/);
    expect(violations).not.toMatch(/VITE_BACKEND_BASE_URL creates/);
  });

  it.each([
    "VITE_BACKEND_BASE_URL=https://allowed.example",
    "VITE_BACKEND_BASE_URL=https://allowed.example/api/v1",
    "VITE_BACKEND_BASE_URL=https://allowed.example/api/v1/",
  ])("accepts canonical public backend input %s", (source) => {
    expect(findArchitectureViolations(new Map([[".env.production", source]]))).toEqual([]);
  });

  it.each([
    ["VITE_AUTHORIZATION=redacted", /exact public Vite variable allowlist/],
    ["VITE_BEARER=redacted", /exact public Vite variable allowlist/],
    ["VITE_SESSION_COOKIE=redacted", /exact public Vite variable allowlist/],
    ["VITE_ACCESS_KEY=redacted", /exact public Vite variable allowlist/],
    ["VITE_BACKEND_BASE_URL=https://user:password@example.com/api/v1", /must not contain credentials/],
    ["VITE_BACKEND_BASE_URL=https://@example.com/api/v1", /must not contain credentials/],
    ["VITE_BACKEND_BASE_URL=https://:@example.com/api/v1", /must not contain credentials/],
    ["VITE_BACKEND_BASE_URL=https://example.com/api/v1?token=redacted", /query or fragment/],
    ["VITE_BACKEND_BASE_URL=https://example.com/api/v1#redacted", /query or fragment/],
    ["VITE_BACKEND_BASE_URL=https://example.com/api/v1?", /query or fragment/],
    ["VITE_BACKEND_BASE_URL=https://example.com/api/v1#", /query or fragment/],
    ["VITE_BACKEND_BASE_URL=https://example.com/v1", /legacy \/v1 is not supported/],
    ["VITE_BACKEND_BASE_URL=https://example.com/proxy/api/v1", /path must be empty or \/api\/v1/],
    ["VITE_BACKEND_BASE_URL=https://example.com/api/./v1", /path must be empty or \/api\/v1/],
    ["VITE_BACKEND_BASE_URL=https://example.com/api/%2e/v1", /path must be empty or \/api\/v1/],
    ["VITE_BACKEND_BASE_URL=https://example.com/api\\v1", /path must be empty or \/api\/v1/],
    ["VITE_BACKEND_BASE_URL=https://exam\tple.com/api/v1", /control characters/],
    ['VITE_BACKEND_BASE_URL="\thttps://example.com/api/v1"', /control characters/],
  ])("rejects unsafe public environment input %s", (source, expectedMessage) => {
    expect(findArchitectureViolations(new Map([[".env.production", source]])).join("\n")).toMatch(
      expectedMessage,
    );
  });

  it("rejects inline application scripts in index.html", () => {
    const sources = new Map([
      ["index.html", `<main id="root"></main><script type="module">fetch("/v1")</script>`],
    ]);

    expect(findArchitectureViolations(sources).join("\n")).toMatch(/inline application scripts/);
  });

  it("allows only the canonical composition script in index.html", () => {
    const allowed = new Map([
      ["index.html", `<main id="root"></main><script type="module" src="/src/main.tsx"></script>`],
    ]);
    const bypasses = new Map([
      [
        "index.html",
        `<script type="module" src="/bypass.js"></script><script src="https://evil.example/app.js"></script>`,
      ],
    ]);

    expect(findArchitectureViolations(allowed)).toEqual([]);
    const violations = findArchitectureViolations(bypasses).join("\n");
    expect(violations).toMatch(/\/bypass\.js.*bypasses/);
    expect(violations).toMatch(/https:\/\/evil\.example\/app\.js.*bypasses/);
    expect(violations).toMatch(/exactly one \/src\/main\.tsx/);
  });

  it.each(["text/plain", "application/json", "importmap", "text/javascript"])(
    "rejects the canonical composition source with non-module type %s",
    (type) => {
      const sources = new Map([
        ["index.html", `<script type="${type}" src="/src/main.tsx"></script>`],
      ]);

      expect(findArchitectureViolations(sources).join("\n")).toMatch(
        /must be loaded by an executable type="module" script/,
      );
    },
  );

  it("rejects feature access to runtime composition APIs", () => {
    const sources = new Map([
      [
        "src/features/chat/unsafe.ts",
        `
          import { installRuntimeConfig, __resetRuntimeConfigForTests } from "@/runtime/runtimeConfig";
          import { resolveBrowserRuntimeConfig } from "@/runtime/browserRuntime";
          installRuntimeConfig(resolveBrowserRuntimeConfig());
          __resetRuntimeConfigForTests();
        `,
      ],
    ]);

    const violations = findArchitectureViolations(sources).join("\n");
    expect(violations).toMatch(/installRuntimeConfig is a concrete runtime composition API/);
    expect(violations).toMatch(/resolveBrowserRuntimeConfig is a concrete runtime composition API/);
    expect(violations).toMatch(/__resetRuntimeConfigForTests is a concrete runtime composition API/);
  });

  it("rejects application dependencies from pre-install runtime modules", () => {
    const sources = new Map([
      ["src/runtime/browserRuntime.ts", `import "../services/api/index"; import "@services";`],
    ]);

    const violations = findArchitectureViolations(sources).join("\n");
    expect(violations).toMatch(
      /pre-install runtime module.*cannot depend on application module/,
    );
    expect(violations).toMatch(/application module @services/);
  });

  it("keeps the preload error policy dependency-free before runtime installation", () => {
    const safePolicy = new Map([
      [
        "src/runtime/preloadErrorPolicy.ts",
        `export const isSettingsFeaturePreloadError = (payload: unknown) => typeof payload === "string";`,
      ],
    ]);
    expect(findArchitectureViolations(safePolicy)).toEqual([]);

    const applicationImport = new Map([
      ["src/runtime/preloadErrorPolicy.ts", `import "../App";`],
    ]);
    expect(findArchitectureViolations(applicationImport).join("\n")).toMatch(
      /pre-install runtime module.*cannot depend on application module/,
    );

    const dynamicImport = new Map([
      [
        "src/runtime/preloadErrorPolicy.ts",
        `const moduleName = "../App"; void import(moduleName);`,
      ],
    ]);
    expect(findArchitectureViolations(dynamicImport).join("\n")).toMatch(
      /pre-install runtime module.*requires a static approved dependency/,
    );
  });

  it("rejects production imports of verifier-excluded test modules", () => {
    const sources = new Map([
      [
        "src/features/chat/unsafe.ts",
        `
          import helper from "../../transport.test";
          import workerUrl from "../../hidden.test.ts?worker";
          new Worker(new URL("../../hidden.test.ts", import.meta.url));
        `,
      ],
    ]);

    const violations = findArchitectureViolations(sources).join("\n");
    expect(violations).toMatch(
      /cannot import a verifier-excluded test module/,
    );
    expect(violations).toMatch(/cannot reference a verifier-excluded test module/);
  });

  it("rejects production dependencies that escape the scanned src tree", () => {
    const sources = new Map([
      [
        "src/features/chat/unsafe.ts",
        `
          import "../../../scripts/hiddenTransport.ts";
          void import("../../../scripts/hiddenWorker.ts?worker");
          new Worker(new URL("../../../scripts/hiddenWorker.ts", import.meta.url));
        `,
      ],
    ]);

    const violations = findArchitectureViolations(sources).filter((message) =>
      message.includes("unverified module outside src/"),
    );
    expect(violations).toHaveLength(3);
  });

  it.each([
    `const moduleName = "../services/api"; void import(moduleName);`,
    `const moduleName = "../services/api"; require(moduleName);`,
  ])("rejects non-static dependencies from a pre-install runtime module", (source) => {
    expect(
      findArchitectureViolations(new Map([["src/runtime/browserRuntime.ts", source]])).join("\n"),
    ).toMatch(/pre-install runtime module.*requires a static approved dependency/);
  });

  it("checks a static dynamic import even when import options are present", () => {
    const sources = new Map([
      [
        "src/runtime/browserRuntime.ts",
        `void import("../services/api/index", { with: { type: "json" } });`,
      ],
    ]);

    expect(findArchitectureViolations(sources).join("\n")).toMatch(
      /pre-install runtime module.*cannot depend on application module/,
    );
  });

  it("includes env files and index.html in the real repository walk", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lotus-next-architecture-"));
    try {
      await mkdir(path.join(root, "src"));
      await writeFile(
        path.join(root, "src/main.tsx"),
        `const bootstrap = async () => { installRuntimeConfig(runtime); await import("./Root.tsx"); }; void bootstrap();`,
      );
      await writeFile(path.join(root, ".env.production"), "VITE_DEVICE_TOKEN=unsafe\n");
      await writeFile(path.join(root, "src/transport.mts"), `fetch("https://backend.example/v1");`);
      await writeFile(
        path.join(root, "index.html"),
        `<script type="module">new WebSocket("ws://localhost/v2/stream")</script>`,
      );

      const failures = (await verifyRepositoryArchitecture(root)).join("\n");
      expect(failures).toMatch(/\.env\.production.*secret-shaped variable VITE_DEVICE_TOKEN/);
      expect(failures).toMatch(/index\.html.*inline application scripts/);
      expect(failures).toMatch(/transport\.mts.*second HTTP transport owner/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed when the Fetch owner moves even if the global count is unchanged", () => {
    const baseline = new Map([
      ["src/services/api/transport.ts", "const browserFetch = globalThis.fetch;"],
      ["src/services/api/index.ts", "const transport = createBrowserHttpTransport();"],
    ]);
    const moved = new Map([
      ["src/services/api/client.ts", "const browserFetch = globalThis.fetch;"],
      ["src/services/api/index.ts", "const transport = createBrowserHttpTransport();"],
    ]);
    const expected = buildInventory(baseline);

    expect(compareInventory(buildInventory(baseline), expected)).toEqual([]);
    const failures = compareInventory(buildInventory(moved), expected).join("\n");
    expect(failures).toMatch(/fetch-reference: src\/services\/api\/transport\.ts.*expected 1/);
    expect(failures).toMatch(/fetch-reference: src\/services\/api\/client\.ts.*expected 0/);
  });

  it("fails closed on duplicate production transport construction", () => {
    const baseline = new Map([
      [
        "src/services/api/transport.ts",
        "const create = () => new HttpTransport({ fetchImplementation: globalThis.fetch });",
      ],
      ["src/services/api/index.ts", "const transport = createBrowserHttpTransport();"],
    ]);
    const duplicated = new Map([
      [
        "src/services/api/transport.ts",
        `
          const create = () => new HttpTransport({ fetchImplementation: globalThis.fetch });
          const duplicate = () => new HttpTransport({ fetchImplementation: injectedFetch });
        `,
      ],
      [
        "src/services/api/index.ts",
        `
          const first = createBrowserHttpTransport();
          const second = createBrowserHttpTransport();
        `,
      ],
    ]);
    const expected = buildInventory(baseline);
    const failures = compareInventory(buildInventory(duplicated), expected).join("\n");

    expect(compareInventory(buildInventory(baseline), expected)).toEqual([]);
    expect(failures).toMatch(/http-transport-constructor.*has 2 occurrence.*expected 1/);
    expect(failures).toMatch(/browser-http-transport-composition.*has 2 occurrence.*expected 1/);
  });

  it("allows runtime installation before a dynamic Root import", () => {
    expect(
      verifyBootstrapOrder(`
        import { StrictMode } from "react";
        import { createRoot } from "react-dom/client";
        import { resolveDefaultBrowserRuntimeConfig } from "./runtime/browserRuntime.ts";
        import { isSettingsFeaturePreloadError } from "./runtime/preloadErrorPolicy.ts";
        import { installRuntimeConfig } from "./runtime/runtimeConfig.ts";
        void isSettingsFeaturePreloadError;
        const bootstrap = async () => {
          installRuntimeConfig(resolveDefaultBrowserRuntimeConfig());
          const [{ default: Root }, { default: ErrorBoundary }] = await Promise.all([
            import("./Root.tsx"),
            import("./components/app/ErrorBoundary.tsx"),
          ]);
          createRoot(rootElement).render(
            <StrictMode><ErrorBoundary name="Root"><Root /></ErrorBoundary></StrictMode>,
          );
        };
        void bootstrap();
      `),
    ).toEqual([]);
  });

  it.each([
    [
      `import Application from "./Root";\nconst bootstrap = async () => { installRuntimeConfig(runtime); await import('./Root.tsx'); };\nvoid bootstrap();`,
      /unsafe static application import/,
    ],
    [
      `import "@app/App";\nconst bootstrap = async () => { installRuntimeConfig(runtime); await import('./Root.tsx'); };\nvoid bootstrap();`,
      /unsafe static application import/,
    ],
    [
      `import "@pages/Home";\nconst bootstrap = async () => { installRuntimeConfig(runtime); await import('./Root.tsx'); };\nvoid bootstrap();`,
      /unsafe static application import/,
    ],
    [
      `import "/src/services/api/index.ts";\nconst bootstrap = async () => { installRuntimeConfig(runtime); await import('./Root.tsx'); };\nvoid bootstrap();`,
      /unsafe static application import/,
    ],
    [
      `import "@services";\nconst bootstrap = async () => { installRuntimeConfig(runtime); await import('./Root.tsx'); };\nvoid bootstrap();`,
      /unsafe static application import/,
    ],
    [
      `import "./runtime/otherPolicy.ts";\nconst bootstrap = async () => { installRuntimeConfig(runtime); await import('./Root.tsx'); };\nvoid bootstrap();`,
      /unsafe static application import/,
    ],
    [
      `import ReactDOM from "react-dom";\nconst bootstrap = async () => { installRuntimeConfig(runtime); await import('./Root.tsx'); };\nvoid bootstrap();`,
      /unsafe static application import/,
    ],
    [
      `export * from "./services/api";\nconst bootstrap = async () => { installRuntimeConfig(runtime); await import('./Root.tsx'); };\nvoid bootstrap();`,
      /unsafe static application re-export/,
    ],
    [
      `const bootstrap = async () => { await import('./Root.tsx'); installRuntimeConfig(runtime); };\nvoid bootstrap();`,
      /precedes runtime installation/,
    ],
    [
      `const bootstrap = async () => { if (false) installRuntimeConfig(runtime); await import('./Root.tsx'); };\nvoid bootstrap();`,
      /unconditional statement/,
    ],
    [
      `const bootstrap = async () => { installRuntimeConfig(runtime); if (false) await import('./Root.tsx'); };\nvoid bootstrap();`,
      /precedes runtime installation/,
    ],
    [
      `const bootstrap = async () => { installRuntimeConfig(runtime); await import('./Root.tsx'); };\nfalse && bootstrap();`,
      /once and unconditionally/,
    ],
    [
      `const early = import('/src/services/api/index.ts');\nconst bootstrap = async () => { installRuntimeConfig(runtime); await import('./Root.tsx'); };\nvoid bootstrap();`,
      /precedes runtime installation/,
    ],
    [
      `const bootstrap = async () => { installRuntimeConfig(runtime); await import(path); await import('./Root.tsx'); };\nvoid bootstrap();`,
      /static module name/,
    ],
    [
      `const bootstrap = async () => { return; installRuntimeConfig(runtime); const [Root] = await Promise.all([import('./Root.tsx')]); createRoot(root).render(Root); };\nvoid bootstrap();`,
      /three reachable statements/,
    ],
    [
      `const bootstrap = async () => { installRuntimeConfig(runtime); const [Root] = await Promise.all([import('./Root.tsx')]); createRoot(root).render(Root); };\nvoid bootstrap();\nvoid bootstrap();`,
      /exactly once and unconditionally/,
    ],
    [
      `const eager = import.meta.glob('./**/*.tsx', { eager: true });\nconst bootstrap = async () => { installRuntimeConfig(runtime); const [Root] = await Promise.all([import('./Root.tsx')]); createRoot(root).render(Root); };\nvoid bootstrap();`,
      /import\.meta\.glob bypasses/,
    ],
    [
      `const bootstrap = async () => { installRuntimeConfig(runtime); const modules = Promise.all([import('./Root.tsx')]); createRoot(root).render(null); };\nvoid bootstrap();`,
      /three reachable statements/,
    ],
    [
      `const bootstrap = async () => { installRuntimeConfig(runtime); const [Root] = await Promise.all([import('./Root.tsx')]); false && createRoot(root).render(Root); };\nvoid bootstrap();`,
      /three reachable statements/,
    ],
    [
      `const bootstrap = async () => { installRuntimeConfig(runtime); const [Root] = await Promise.all([import('./Root.tsx')]); createRoot(root).render(Root); };\nvoid bootstrap();\nconst run = bootstrap;\nvoid run();`,
      /exactly once and unconditionally/,
    ],
    [
      `createRoot(root).render(null);\nconst bootstrap = async () => { installRuntimeConfig(runtime); const [Root] = await Promise.all([import('./Root.tsx')]); createRoot(root).render(Root); };\nvoid bootstrap();`,
      /three reachable statements/,
    ],
    [
      `import { StrictMode } from 'react'; import { createRoot } from 'react-dom/client'; import { resolveDefaultBrowserRuntimeConfig } from './runtime/browserRuntime.ts'; import { installRuntimeConfig } from './runtime/runtimeConfig.ts'; const bootstrap = async () => { installRuntimeConfig(resolveDefaultBrowserRuntimeConfig()); const [{ default: Root }, { default: ErrorBoundary }] = await Promise.all([import('./Root.tsx'), import('./components/app/ErrorBoundary.tsx')]); createRoot(rootElement).render(null); }; void bootstrap();`,
      /three reachable statements/,
    ],
    [
      `import { StrictMode } from 'react'; import { createRoot } from 'react-dom/client'; import { resolveDefaultBrowserRuntimeConfig } from './runtime/browserRuntime.ts'; import { installRuntimeConfig } from './runtime/runtimeConfig.ts'; const bootstrap = async (createRoot) => { installRuntimeConfig(resolveDefaultBrowserRuntimeConfig()); const [{ default: Root }, { default: ErrorBoundary }] = await Promise.all([import('./Root.tsx'), import('./components/app/ErrorBoundary.tsx')]); createRoot(rootElement).render(<StrictMode><ErrorBoundary name="Root"><Root /></ErrorBoundary></StrictMode>); }; void bootstrap();`,
      /three reachable statements/,
    ],
    [
      `import { StrictMode } from 'react'; import { createRoot } from 'react-dom/client'; import { createRoot as mountEarly } from 'react-dom/client'; import { resolveDefaultBrowserRuntimeConfig } from './runtime/browserRuntime.ts'; import { installRuntimeConfig } from './runtime/runtimeConfig.ts'; mountEarly(rootElement).render(null); const bootstrap = async () => { installRuntimeConfig(resolveDefaultBrowserRuntimeConfig()); const [{ default: Root }, { default: ErrorBoundary }] = await Promise.all([import('./Root.tsx'), import('./components/app/ErrorBoundary.tsx')]); createRoot(rootElement).render(<StrictMode><ErrorBoundary name="Root"><Root /></ErrorBoundary></StrictMode>); }; void bootstrap();`,
      /three reachable statements/,
    ],
  ])("rejects an unsafe bootstrap ordering", (source, expectedMessage) => {
    expect(verifyBootstrapOrder(source).join("\n")).toMatch(expectedMessage);
  });
});
