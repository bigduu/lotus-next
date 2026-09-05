import path from "node:path"

import { describe, expect, it } from "vitest"
import { resolveConfig } from "vite"

import {
  assertCanonicalSourceAliases,
  assertSafePublicBuildEnvironment,
  canonicalSourceAliasPlugin,
  classifyVendorChunk,
  developmentProxy,
  portableArtifactBase,
} from "./vite.config"

const canonicalResolvedAliases = (projectRoot: string) => [
  { find: "@", replacement: `${projectRoot}/src` },
  { find: "@services", replacement: `${projectRoot}/src/services` },
  { find: "@shared", replacement: `${projectRoot}/src/shared` },
  { find: "@pages", replacement: `${projectRoot}/src/pages` },
  { find: "@components", replacement: `${projectRoot}/src/components` },
  { find: "@app", replacement: `${projectRoot}/src/app` },
  {
    find: /^\/?@vite\/env/,
    replacement: "/@fs/node_modules/vite/dist/client/env.mjs",
  },
  {
    find: /^\/?@vite\/client/,
    replacement: "/@fs/node_modules/vite/dist/client/client.mjs",
  },
]

const nonExactBackendInputs = [
  "https://backend.example:8443?", "https://backend.example:8443#",
  "https://backend.example:8443/api/v1?", "https://backend.example:8443/api/v1#",
  "https://backend.example:8443/api/./v1", "https://backend.example:8443/api/%2e/v1",
  String.raw`https://backend.example:8443/api\v1`, "https://exam\tple.com/api/v1",
  "https://exam\nple.com/api/v1", "\thttps://backend.example:8443/api/v1",
  "https://backend.example:8443/api/v1\n", "https://@backend.example:8443/api/v1",
  "https://:@backend.example:8443/api/v1",
]

describe("public Vite build environment", () => {
  it.each([
    "https://backend.example:8443",
    "https://backend.example:8443/",
    "https://backend.example:8443/api/v1",
    "https://backend.example:8443/api/v1/",
  ])("accepts documented metadata with canonical backend input %s", (backendBaseUrl) => {
    expect(() =>
      assertSafePublicBuildEnvironment({
        VITE_APP_REVISION: "revision",
        VITE_APP_VERSION: "1.2.3",
        VITE_BACKEND_BASE_URL: backendBaseUrl,
      }),
    ).not.toThrow()
  })

  it.each([
    "VITE_AUTHORIZATION",
    "VITE_BEARER",
    "VITE_SESSION_COOKIE",
    "VITE_ACCESS_KEY",
    "VITE_SECOND_BACKEND_ORIGIN",
  ])("rejects undeclared client-exposed input %s", (name) => {
    expect(() => assertSafePublicBuildEnvironment({ [name]: "redacted" })).toThrow(
      "outside the exact Lotus Next public build variable schema",
    )
  })

  it.each([
    ["https://user:password@backend.example/api/v1", "must not contain credentials"],
    ["https://backend.example/api/v1?token=redacted", "must not contain a query or fragment"],
    ["https://backend.example/api/v1#redacted", "must not contain a query or fragment"],
    ["https://backend.example/v1", "legacy /v1 is not supported by new builds"],
    ["https://backend.example/proxy/api/v1", "path must be empty or /api/v1"],
    ["file:///tmp/backend", "must use HTTP or HTTPS"],
    ["not-a-url", "must be an absolute HTTP(S) URL"],
    ...nonExactBackendInputs.map((input) => [input, undefined] as const),
  ])("rejects unsafe or non-exact canonical backend input %s", (backendBaseUrl, message) => {
    expect(() => assertSafePublicBuildEnvironment({ VITE_BACKEND_BASE_URL: backendBaseUrl })).toThrow(
      message,
    )
  })
  it("does not expose the legacy native /v1 alias", () => {
    expect(Object.keys(developmentProxy).sort()).toEqual(["/api", "/v2"])
  })

  it("keeps the production artifact portable across nested host mount paths", () => {
    expect(portableArtifactBase).toBe("./")
  })
})

describe("Vite source alias identity", () => {
  const projectRoot = "/workspace/lotus-next"

  it("accepts only the resolved canonical roots plus Vite's internal aliases", () => {
    expect(() => assertCanonicalSourceAliases(canonicalResolvedAliases(projectRoot), projectRoot)).not.toThrow()
  })

  it("allows harmless reordering within the complete canonical user alias table", () => {
    const aliases = canonicalResolvedAliases(projectRoot)
    const reordered = [aliases[1], aliases[0], ...aliases.slice(2)]
    expect(() => assertCanonicalSourceAliases(reordered, projectRoot)).not.toThrow()
  })

  it.each([
    ["Vite development", "vite.config.ts", "serve", "development"],
    ["Vite production", "vite.config.ts", "build", "production"],
    ["Vitest", "vitest.config.ts", "serve", "test"],
  ] as const)(
    "resolves protected imports to their physical sources after %s config hooks",
    async (_label, configFile, command, mode) => {
      const repositoryRoot = path.resolve(process.cwd())
      const config = await resolveConfig(
        {
          configFile: path.join(repositoryRoot, configFile),
          logLevel: "silent",
          mode,
        },
        command,
      )
      assertCanonicalSourceAliases(config.resolve.alias, repositoryRoot)
      const resolve = config.createResolver()
      const channelService = path.join(repositoryRoot, "src/services/notification/notificationChannelsApi.ts")
      const cases = [
        ["@/lib/secrets.ts", channelService, "src/lib/secrets.ts"],
        ["@/lib/secrets", channelService, "src/lib/secrets.ts"],
        [
          "@services/notification/notificationChannelsApi.ts",
          path.join(repositoryRoot, "src/components/chat/settings/notifications/ChannelsSection.tsx"),
          "src/services/notification/notificationChannelsApi.ts",
        ],
        [
          "@components/chat/settings/SettingsNotifications.tsx",
          path.join(repositoryRoot, "src/pages/Settings.tsx"),
          "src/components/chat/settings/SettingsNotifications.tsx",
        ],
        ["../api/index.ts", channelService, "src/services/api/index.ts"],
      ] as const
      for (const [specifier, importer, expected] of cases) {
        expect(path.normalize((await resolve(specifier, importer)) ?? "")).toBe(
          path.normalize(path.join(repositoryRoot, expected)),
        )
      }
    },
  )

  it("rejects an alias injected by a completed config hook", async () => {
    const repositoryRoot = path.resolve(process.cwd())
    const rawAliases = Object.fromEntries(
      canonicalResolvedAliases(repositoryRoot)
        .slice(0, 6)
        .map((alias) => [alias.find, alias.replacement]),
    )
    await expect(
      resolveConfig(
        {
          configFile: false,
          root: repositoryRoot,
          logLevel: "silent",
          mode: "production",
          resolve: { alias: rawAliases },
          plugins: [
            {
              name: "redirect-protected-source",
              config() {
                return {
                  resolve: {
                    alias: [
                      {
                        find: "@/lib/secrets.ts",
                        replacement: path.join(repositoryRoot, "src/services/notification/notificationPreferencesApi.ts"),
                      },
                    ],
                  },
                }
              },
            },
            canonicalSourceAliasPlugin(),
          ],
        },
        "build",
      ),
    ).rejects.toThrow("only the six canonical source roots")
  })

  it.each([
    [
      "an exact protected redirect",
      [
        {
          find: "@/lib/secrets.ts",
          replacement: `${projectRoot}/src/services/notificationRelay.ts`,
        },
        ...canonicalResolvedAliases(projectRoot),
      ],
    ],
    [
      "a relative protected redirect",
      [
        {
          find: "../api/index.ts",
          replacement: `${projectRoot}/src/services/notificationRelay.ts`,
        },
        ...canonicalResolvedAliases(projectRoot),
      ],
    ],
    [
      "a changed canonical replacement",
      canonicalResolvedAliases(projectRoot).map((alias, index) =>
        index === 0
          ? {
              ...alias,
              replacement: `${projectRoot}/src/services/notificationRelay.ts`,
            }
          : alias,
      ),
    ],
    [
      "a relative canonical replacement",
      canonicalResolvedAliases(projectRoot).map((alias, index) =>
        index === 4 ? { ...alias, replacement: "./src/components" } : alias,
      ),
    ],
    [
      "a custom alias resolver",
      canonicalResolvedAliases(projectRoot).map((alias, index) =>
        index === 0 ? { ...alias, customResolver: () => null } : alias,
      ),
    ],
    [
      "an appended alias",
      [...canonicalResolvedAliases(projectRoot), { find: "@extra", replacement: `${projectRoot}/src/extra` }],
    ],
  ])("rejects %s after Vite resolves configuration hooks", (_label, aliases) => {
    expect(() => assertCanonicalSourceAliases(aliases, projectRoot)).toThrow("only the six canonical source roots")
  })
})

describe("vendor chunk ownership", () => {
  it.each([
    ["/repo/node_modules/streamdown/dist/index.js", "vendor-streamdown"],
    ["/repo/node_modules/@streamdown/cjk/dist/index.js", "vendor-streamdown"],
    ["/repo/node_modules/streamdown/node_modules/marked/lib/marked.esm.js", "vendor-streamdown"],
    ["/repo/node_modules/@streamdown/code/dist/index.js", "vendor-streamdown-code"],
    ["/repo/node_modules/@shikijs/core/dist/index.mjs", "vendor-streamdown-code"],
    ["/repo/node_modules/shiki/dist/index.mjs", "vendor-streamdown-code"],
    ["/repo/node_modules/oniguruma-to-es/dist/index.js", "vendor-streamdown-code"],
    ["/repo/node_modules/@streamdown/mermaid/dist/index.js", "vendor-mermaid"],
    ["/repo/node_modules/mermaid/dist/mermaid.esm.mjs", "vendor-mermaid"],
    ["/repo/node_modules/d3-scale/src/index.js", "vendor-mermaid"],
    ["/repo/node_modules/internmap/src/index.js", "vendor-mermaid"],
    ["C:\\repo\\node_modules\\cytoscape\\dist\\cytoscape.esm.mjs", "vendor-mermaid"],
    ["/repo/node_modules/vfile/index.js", "vendor-markdown"],
    ["/repo/node_modules/parse5/dist/index.js", "vendor-markdown"],
    ["/repo/node_modules/react-syntax-highlighter/dist/esm/prism-async-light.js", "vendor-highlighter"],
  ])("keeps %s in the lazy %s graph", (id, chunk) => {
    expect(classifyVendorChunk(id)).toBe(chunk)
  })

  it("does not put application modules into a vendor group", () => {
    expect(classifyVendorChunk("/repo/src/components/chat/StreamdownMarkdown.tsx")).toBeUndefined()
  })

  it("leaves cross-renderer URL metadata in a neutral shared chunk", () => {
    expect(
      classifyVendorChunk("/repo/node_modules/html-url-attributes/index.js"),
    ).toBeUndefined()
  })

  it.each([
    "/repo/node_modules/@radix-ui/react-switch/dist/index.mjs",
    "/repo/node_modules/@radix-ui/react-label/dist/index.mjs",
    "/repo/node_modules/html2canvas/dist/html2canvas.esm.js",
    "/repo/node_modules/jspdf/dist/jspdf.es.min.js",
  ])("leaves optional-feature package %s with its owning dynamic graph", (id) => {
    expect(classifyVendorChunk(id)).toBeUndefined()
  })
})
