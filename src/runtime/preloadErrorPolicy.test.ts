import { describe, expect, it } from "vitest"

import { isLocalFeaturePreloadError } from "./preloadErrorPolicy"

describe("local feature preload error policy", () => {
  it.each([
    "Failed to fetch dynamically imported module: https://app.example/assets/Settings-AbC_123.js",
    "Unable to preload CSS for /base/assets/Settings-z9-Y.js?revision=next",
    "Unable to preload CSS for /base/assets/Settings-z9-Y.css?revision=next",
    new Error("Unable to preload CSS for /assets/Settings-z9-Y.css"),
    new Error("Failed to fetch dynamically imported module: /assets/Settings-z9-Y.js"),
    new Error("Importing a module script failed: /assets/Settings-123.js#retry"),
    new Error("Failed to fetch dynamically imported module: https://app.example/assets/WorkflowRunsContent-AbC_123.js"),
    "Unable to preload CSS for /base/assets/WorkflowRunsContent-z9-Y.css?revision=next",
  ])("routes only known shell-preserving feature failures locally", (payload) => {
    expect(isLocalFeaturePreloadError(payload)).toBe(true)
  })

  it.each([
    "Failed to fetch /assets/settings-AbC.js",
    "Failed to fetch /assets/Settings.js",
    "Failed to fetch /assets/SettingsPanel-AbC.css",
    "Failed to fetch /assets/WorkflowRunsContent.js",
    "Failed to fetch /assets/WorkflowRunsDialog-AbC.js",
    "Failed to fetch /assets/workflowrunscontent-AbC.js",
    "Failed to fetch /assets/vendor-mermaid-AbC.js",
    new Error("Failed to fetch /assets/renderPdf-AbC.js"),
    { message: "Failed to fetch /assets/Settings-AbC.js" },
    null,
  ])("keeps unrelated or ambiguous preload failures on the existing policy", (payload) => {
    expect(isLocalFeaturePreloadError(payload)).toBe(false)
  })
})
