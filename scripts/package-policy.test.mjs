import { describe, expect, it } from "vitest"

import { findUnexpectedPackagePaths, isUnexpectedPackagePath } from "./package-policy.mjs"

describe("publishable package path policy", () => {
  it.each([
    "src/main.tsx",
    "vite.config.ts",
    "dist/.cache/index.bin",
    "dist/cache/state.json",
    "dist/Cache/state.json",
    "dist/cache.json",
    "dist/assets/state-cache.json",
    "dist/assets/bundle.cache",
    "dist/coverage/index.html",
    "dist/.env.production",
    "dist/secret.json",
    "dist/credentials.json",
    "dist/token.json",
    "dist/api-key.json",
    "dist/vite.config.js",
    "dist/local.config.json",
    "dist/tsconfig.json",
    "dist/package-lock.json",
    "dist/assets/component.test.js",
    "dist/assets/component.test.json",
    "dist/assets/index.js.map",
    "dist/assets/index.js.map.gz",
    "dist/components/Button.jsx",
    "dist/components/App.vue",
    "dist/SRC/main.js",
    "dist/source/main.js",
    "dist/Fixtures/session.json",
    "dist/__mocks__/session.json",
    "dist/TESTS/unit.js",
    "dist/secrets/runtime.json",
    "dist/credentials/runtime.json",
    "dist/styles/theme.scss",
    "dist/fixtures/session.json",
    "dist/assets/signing-key.pem",
    "dist/assets/signing-key.txt",
    "LICENSE.pem",
    "LICENSE.key",
    "dist/../package-lock.json",
  ])("rejects development or sensitive path %s", (path) => {
    expect(isUnexpectedPackagePath(path)).toBe(true)
  })

  it.each([
    "LICENSE",
    "LICENSE.md",
    "LICENSE.txt",
    "README.md",
    "package.json",
    "dist/index.html",
    "dist/favicon.svg",
    "dist/assets/index-AbCd1234.js",
    "dist/assets/index-AbCd1234.css",
    "dist/assets/config-AbCd1234.js",
  ])("allows runtime or required metadata path %s", (path) => {
    expect(isUnexpectedPackagePath(path)).toBe(false)
  })

  it("returns every rejected path for verifier diagnostics", () => {
    expect(
      findUnexpectedPackagePaths([
        "README.md",
        "dist/index.html",
        "dist/assets/index.js",
        "dist/.cache/state.json",
        "dist/secret.json",
      ]),
    ).toEqual(["dist/.cache/state.json", "dist/secret.json"])
  })
})
