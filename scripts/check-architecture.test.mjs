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

describe("architecture boundary fixtures", () => {
  it("allows the designated runtime, composition, and transport adapters", () => {
    const sources = new Map([
      [
        "src/runtime/browserRuntime.ts",
        `
          const base = import.meta.env.VITE_BACKEND_BASE_URL;
          const key = "copilot_backend_base_url";
          const port = window.__BAMBOO_BACKEND_PORT__;
          const tauri = window.__TAURI_INTERNALS__;
        `,
      ],
      ["src/services/api/client.ts", `fetch("/v1/status");`],
      [
        "src/services/api/index.ts",
        `
          const runtime = getRuntimeConfig();
          new ApiClient({ baseUrl: runtime.endpoints.standardApi });
          new ApiClient({ baseUrl: runtime.endpoints.agentApi });
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
          const example = "new WebSocket(endpoint)";
          const note = "import.meta.env.VITE_BACKEND_BASE_URL";
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

  it("distinguishes domain fetch methods from browser-global fetch access", () => {
    const safeSources = new Map([
      ["src/domain/cache.ts", `class Cache { fetch(key) { return key; } } cache.fetch(key);`],
    ]);
    const unsafeSources = new Map([
      [
        "src/domain/cache.ts",
        `const send = globalThis.fetch; const { fetch: otherSend } = window; send(url); otherSend(url);`,
      ],
    ]);

    expect(findArchitectureViolations(safeSources)).toEqual([]);
    expect(findArchitectureViolations(unsafeSources).join("\n")).toMatch(
      /second HTTP transport owner/,
    );
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
    ["VITE_AUTHORIZATION=redacted", /exact public Vite variable allowlist/],
    ["VITE_BEARER=redacted", /exact public Vite variable allowlist/],
    ["VITE_SESSION_COOKIE=redacted", /exact public Vite variable allowlist/],
    ["VITE_ACCESS_KEY=redacted", /exact public Vite variable allowlist/],
    ["VITE_BACKEND_BASE_URL=https://user:password@example.com/v1", /must not contain credentials/],
    ["VITE_BACKEND_BASE_URL=https://example.com/v1?token=redacted", /query or fragment/],
    ["VITE_BACKEND_BASE_URL=https://example.com/v1#redacted", /query or fragment/],
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

  it("freezes both owner names and occurrence counts", () => {
    const baseline = new Map([
      ["src/services/api/client.ts", "fetch('/one'); fetch('/two');"],
    ]);
    const changed = new Map([
      ["src/services/api/client.ts", "fetch('/one'); fetch('/two'); fetch('/three');"],
    ]);
    const expected = buildInventory(baseline);

    expect(compareInventory(buildInventory(baseline), expected)).toEqual([]);
    expect(compareInventory(buildInventory(changed), expected).join("\n")).toMatch(/expected 2/);
  });

  it("allows runtime installation before a dynamic Root import", () => {
    expect(
      verifyBootstrapOrder(`
        import { StrictMode } from "react";
        import { createRoot } from "react-dom/client";
        import { resolveDefaultBrowserRuntimeConfig } from "./runtime/browserRuntime.ts";
        import { installRuntimeConfig } from "./runtime/runtimeConfig.ts";
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
