import { describe, expect, it } from "vitest"

import { assertSafePublicBuildEnvironment, classifyVendorChunk } from "./vite.config"

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
})
