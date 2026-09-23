import { expect, it } from "vitest"
import { normalizeBrowserAddress, playwrightKey } from "./browserInput"

it("accepts web addresses and rejects explicit non-web schemes", () => {
  expect(normalizeBrowserAddress("example.test/path")).toBe("https://example.test/path")
  expect(normalizeBrowserAddress("localhost:9562")).toBe("http://localhost:9562/")
  expect(normalizeBrowserAddress("file:///tmp/page.html")).toBeNull()
  expect(normalizeBrowserAddress("javascript:alert(1)")).toBeNull()
  expect(normalizeBrowserAddress("data:text/html,x")).toBeNull()
})

it("keeps the Shift modifier when forwarding browser focus navigation", () => {
  expect(playwrightKey({
    key: "Tab",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: true,
  })).toBe("Shift+Tab")
})
