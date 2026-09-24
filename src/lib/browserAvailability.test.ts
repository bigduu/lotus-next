import { describe, expect, it } from "vitest"
import { isPhoneBrowser } from "./browserAvailability"

describe("embedded browser phone detection", () => {
  it("recognizes mobile client hints and iPhone or Android WebView user agents", () => {
    expect(isPhoneBrowser("desktop user agent", true)).toBe(true)
    expect(isPhoneBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148")).toBe(true)
    expect(isPhoneBrowser("Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/X; wv) AppleWebKit/537.36 Chrome/125.0 Mobile Safari/537.36")).toBe(true)
  })

  it("keeps tablets and desktop browsers eligible", () => {
    expect(isPhoneBrowser("Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148", false)).toBe(false)
    expect(isPhoneBrowser("Mozilla/5.0 (Linux; Android 14; Tablet) AppleWebKit/537.36 Chrome/125.0 Safari/537.36")).toBe(false)
    expect(isPhoneBrowser("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15", false)).toBe(false)
  })
})
