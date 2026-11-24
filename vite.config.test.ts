import { describe, expect, it } from "vitest"

import { configureSolidApplication } from "./vite.solid.config"

import {
  assertSafePublicBuildEnvironment,
  developmentProxy,
  portableArtifactBase,
} from "./vite.config"

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

describe("Solid build entry boundaries", () => {
  const environment = { mode: "production", command: "build" } as const

  it("builds the canonical index alone for application and candidate dist", () => {
    const application = configureSolidApplication(environment, "application")
    const candidate = configureSolidApplication(environment, "candidate")
    expect(application.build?.rollupOptions?.input).toEqual(["index.html"])
    expect(candidate.build?.rollupOptions?.input).toEqual(["index.html"])
    expect(application.build?.outDir).toBe("dist")
    expect(candidate.build?.outDir).toBe("dist-solid-artifact")
  })

  it("includes the component gallery in the local preview", () => {
    const preview = configureSolidApplication(environment, "preview")
    expect(preview.build?.rollupOptions?.input).toEqual(["index.html", "solid-preview.html"])
    expect(preview.server?.host).toBe("127.0.0.1")
    expect(preview.build?.outDir).toBe("dist-solid-preview")
  })
})
