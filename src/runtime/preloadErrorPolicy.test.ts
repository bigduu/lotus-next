import { describe, expect, it } from "vitest"

import { isSettingsFeaturePreloadError } from "./preloadErrorPolicy"

describe("Settings preload error policy", () => {
  it.each([
    "Failed to fetch dynamically imported module: https://app.example/assets/Settings-AbC_123.js",
    "Unable to preload CSS for /base/assets/Settings-z9-Y.js?revision=next",
    new Error("Importing a module script failed: /assets/Settings-123.js#retry"),
  ])("routes the exact generated Settings feature failure locally", (payload) => {
    expect(isSettingsFeaturePreloadError(payload)).toBe(true)
  })

  it.each([
    "Failed to fetch /assets/settings-AbC.js",
    "Failed to fetch /assets/Settings.js",
    "Failed to fetch /assets/SettingsPanel-AbC.css",
    "Failed to fetch /assets/vendor-mermaid-AbC.js",
    new Error("Failed to fetch /assets/renderPdf-AbC.js"),
    { message: "Failed to fetch /assets/Settings-AbC.js" },
    null,
  ])("keeps unrelated or ambiguous preload failures on the existing policy", (payload) => {
    expect(isSettingsFeaturePreloadError(payload)).toBe(false)
  })
})
