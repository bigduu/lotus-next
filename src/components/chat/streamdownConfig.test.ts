import { describe, expect, it } from "vitest"

import { localImagePath, nativeImageUrl, safeAssistantUrlTransform } from "./streamdownConfig"

const transform = (url: string, key: string) => safeAssistantUrlTransform(url, key, {} as never)

describe("assistant Markdown URL policy", () => {
  it("recognizes local raster paths without intercepting app assets", () => {
    expect(localImagePath("/Users/example/picture.png")).toBe("/Users/example/picture.png")
    expect(localImagePath("/assets/logo.png")).toBeNull()
    expect(transform("file:///Users/example/secret.svg", "src")).toBeNull()
    expect(transform("file:///Users/example/picture.png", "src")).toBeNull()
    const mac = nativeImageUrl("file:///Users/example/picture%20one.png")
    expect(localImagePath(mac!)).toBe("/Users/example/picture one.png")
    const winFile = nativeImageUrl("file:///C:/Users/example/picture.png")
    expect(localImagePath(winFile!)).toBe("C:/Users/example/picture.png")
    const winDrive = nativeImageUrl("C:\\Users\\example\\picture.png")
    expect(localImagePath(winDrive!)).toBe("C:/Users/example/picture.png")
    expect(nativeImageUrl("file://remote/share/picture.png")).toBeNull()
    expect(nativeImageUrl("file:///Users/example/script.svg")).toBeNull()
    expect(nativeImageUrl("C:\\Users\\example\\script.svg")).toBeNull()
  })
  it.each([
    ["https://example.com/path", "href"],
    ["http://example.com/image.png", "src"],
    ["mailto:user@example.com", "href"],
    ["/relative/path", "href"],
    ["../relative/image.png", "src"],
    ["#section", "href"],
  ])("allows the intentional %s %s surface", (url, key) => {
    expect(transform(url, key)).toBe(url)
  })

  it.each([
    ["javascript:alert(1)", "href"],
    ["JaVaScRiPt:alert(1)", "href"],
    ["vbscript:msgbox(1)", "href"],
    ["data:text/html,<script>alert(1)</script>", "href"],
    ["data:image/svg+xml,<svg onload=alert(1)>", "src"],
    ["blob:https://example.com/id", "src"],
    ["file:///etc/passwd", "href"],
    ["mailto:user@example.com", "src"],
    ["//evil.example/path", "href"],
    ["\\\\evil.example\\path", "href"],
    [" https://example.com", "href"],
    ["https://example.com\njavascript:alert(1)", "href"],
    ["https://example.com", "data-url"],
  ])("rejects unsafe or out-of-schema %s %s", (url, key) => {
    expect(transform(url, key)).toBeNull()
  })
})
