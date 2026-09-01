import { describe, expect, it } from "vitest"

import { assertSafePublicBuildEnvironment } from "./vite.config"

describe("public Vite build environment", () => {
  it("accepts only the documented public metadata and canonical backend input", () => {
    expect(() =>
      assertSafePublicBuildEnvironment({
        VITE_APP_REVISION: "revision",
        VITE_APP_VERSION: "1.2.3",
        VITE_BACKEND_BASE_URL: "https://backend.example:8443/v1",
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
    ["https://user:password@backend.example/v1", "must not contain credentials"],
    ["https://backend.example/v1?token=redacted", "must not contain a query or fragment"],
    ["https://backend.example/v1#redacted", "must not contain a query or fragment"],
    ["https://backend.example/proxy/v1", "path must be empty or /v1"],
    ["file:///tmp/backend", "must use HTTP or HTTPS"],
    ["not-a-url", "must be an absolute HTTP(S) URL"],
  ])("rejects unsafe canonical backend input %s", (backendBaseUrl, message) => {
    expect(() => assertSafePublicBuildEnvironment({ VITE_BACKEND_BASE_URL: backendBaseUrl })).toThrow(
      message,
    )
  })
})
