import mermaid from "mermaid"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { initMermaidForExport, restoreMermaidAppConfig } from "../export/mermaidConfig"
import {
  getTrustedMermaidConfig,
  MERMAID_STRICT_CONFIG,
  initializeTrustedMermaid,
} from "./strictConfig"

const originalTextLength = Object.getOwnPropertyDescriptor(
  SVGElement.prototype,
  "getComputedTextLength",
)
const originalGetBBox = Object.getOwnPropertyDescriptor(SVGElement.prototype, "getBBox")

beforeAll(() => {
  // jsdom does not implement SVG layout metrics; deterministic values keep the
  // real Mermaid parser/sanitizer tests bounded without changing production code.
  Object.defineProperty(SVGElement.prototype, "getComputedTextLength", {
    configurable: true,
    value: () => 100,
  })
  Object.defineProperty(SVGElement.prototype, "getBBox", {
    configurable: true,
    value: () => ({ x: 0, y: 0, width: 100, height: 20 }),
  })
})

afterAll(() => {
  if (originalTextLength) {
    Object.defineProperty(SVGElement.prototype, "getComputedTextLength", originalTextLength)
  } else {
    Reflect.deleteProperty(SVGElement.prototype, "getComputedTextLength")
  }

  if (originalGetBBox) {
    Object.defineProperty(SVGElement.prototype, "getBBox", originalGetBBox)
  } else {
    Reflect.deleteProperty(SVGElement.prototype, "getBBox")
  }
})

beforeEach(() => {
  initializeTrustedMermaid("app")
})

describe("trusted Mermaid security policy", () => {
  it("exposes only the frozen app/export policies to integrations", () => {
    const app = getTrustedMermaidConfig("app")
    const exportConfig = getTrustedMermaidConfig("export")

    expect(Object.isFrozen(app)).toBe(true)
    expect(Object.isFrozen(app.flowchart)).toBe(true)
    expect(app).toMatchObject({
      securityLevel: "strict",
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      theme: "dark",
    })
    expect(exportConfig).toMatchObject({
      securityLevel: "strict",
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      theme: "default",
    })
  })

  it("is recursively frozen and renders normal diagrams in strict native-label mode", async () => {
    expect(Object.isFrozen(MERMAID_STRICT_CONFIG)).toBe(true)
    expect(Object.isFrozen(MERMAID_STRICT_CONFIG.flowchart)).toBe(true)
    expect(Reflect.set(MERMAID_STRICT_CONFIG.flowchart, "htmlLabels", true)).toBe(false)

    const config = mermaid.mermaidAPI.getConfig()
    expect(config).toMatchObject({
      securityLevel: "strict",
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      theme: "dark",
    })

    const { svg } = await mermaid.render(
      "strict-normal",
      "flowchart LR\nA[Safe] --> B[Done]",
    )
    expect(svg).toContain("Safe")
    expect(svg).toContain("Done")
    expect(svg).not.toContain("<foreignObject")
  })

  it("keeps the same strict policy across PDF theme switching", () => {
    initMermaidForExport()
    expect(mermaid.mermaidAPI.getConfig()).toMatchObject({
      securityLevel: "strict",
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      theme: "default",
    })

    restoreMermaidAppConfig()
    expect(mermaid.mermaidAPI.getConfig()).toMatchObject({
      securityLevel: "strict",
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      theme: "dark",
    })
  })

  it("contains architecture prototype and sibling-selector payloads", async () => {
    const marker = "mermaidPrototypePollutionMarker"
    expect(Object.prototype).not.toHaveProperty(marker)

    await mermaid
      .render(
        "strict-prototype",
        `architecture-beta
      group mermaidPrototypePollutionMarker(cloud)[Marker]
      service a(server)[A] in __proto__
      service b(server)[B] in mermaidPrototypePollutionMarker
      a:R -- L:b`,
      )
      // Patched Mermaid may reject the malicious graph or safely render it.
      // The security contract is that neither outcome mutates Object.prototype.
      .catch(() => undefined)
    expect(Object.prototype).not.toHaveProperty(marker)

    const { svg } = await mermaid.render(
      "strict-sibling-selector",
      `---
config:
  themeCSS: |-
    & + * { background:red !important; }
    & ~ * { visibility:hidden !important; }
---
info`,
    )
    // The vulnerable form started directly at `#svgId + *` / `#svgId ~ *`
    // and could select host-page siblings. A patched release may either drop
    // the rule or add another descendant scope inside the SVG.
    expect(svg).toContain('id="strict-sibling-selector"')
    expect(svg).not.toMatch(
      /(?:<style>|})\s*#strict-sibling-selector\s*[+~]\s*\*/,
    )
  })

  it("removes unsafe markup, event handlers, and URL attributes", async () => {
    const { svg } = await mermaid.render(
      "strict-unsafe-markup",
      `flowchart LR
A["<img src=x onerror=alert(1)>"] --> B["<a href=javascript:alert(2)>Click</a>"]
click A "javascript:alert(3)"`,
    )

    expect(svg).not.toContain("<foreignObject")
    expect(svg).not.toContain("<img")
    expect(svg).not.toMatch(/on\w+\s*=/i)
    expect(svg).not.toMatch(/javascript\s*:/i)
  })
})
