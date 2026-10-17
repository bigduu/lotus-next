import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it } from "vitest"
import { Markdown } from "./Markdown"
import { markdownTheme } from "./markdownTheme"

it("uses shared theme tokens for prose, inline code, quotes and table rules without changing safe Markdown semantics", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement("div"); const root = createRoot(host)
  act(() => root.render(<Markdown>{"# Heading\n\nBody `inline` and [safe](https://example.test).\n\n> Quote\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n<script>unsafe()</script>"}</Markdown>))
  const prose = host.firstElementChild as HTMLElement
  for (const [key, value] of Object.entries(markdownTheme)) expect(prose.style.getPropertyValue(key)).toBe(value)
  expect(prose.className).not.toContain("prose-invert")
  expect(prose.className).toContain("prose-headings:mt-4")
  expect(host.querySelector("code")?.className).toContain("bg-muted")
  expect(host.querySelector("a")?.getAttribute("href")).toBe("https://example.test")
  expect(host.querySelector("blockquote")?.textContent).toContain("Quote")
  expect(host.querySelector("table")).not.toBeNull()
  expect(host.querySelector("script")).toBeNull()
  act(() => root.unmount())
})
