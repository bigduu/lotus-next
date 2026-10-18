import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { useThemeStore } from "@shared/store/themeStore"
import oneDark from "react-syntax-highlighter/dist/esm/styles/prism/one-dark"
import coldarkCold from "react-syntax-highlighter/dist/esm/styles/prism/coldark-cold"
import CodeBlock from "./CodeBlock"
const capture = vi.hoisted(() => ({ props: {} as Record<string, unknown> }))
vi.mock("react-syntax-highlighter", () => ({ PrismAsyncLight: (props: Record<string, unknown>) => {
  capture.props = props
  return <pre>{props.children as string}</pre>
} }))
afterEach(() => useThemeStore.setState({ themeMode: "light" }))
it("selects readable light syntax and updates to the existing dark palette without changing source", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement("div"); const root = createRoot(host)
  useThemeStore.setState({ themeMode: "light" })
  const source = 'const message = "中文";\n' + "long_value".repeat(100)
  act(() => root.render(<CodeBlock language="typescript" value={source} />))
  expect(capture.props.style).toBe(coldarkCold)
  expect(capture.props.customStyle).toMatchObject({ background: "var(--card)", overflowWrap: "anywhere", whiteSpace: "pre-wrap" })
  expect(host.textContent).toBe(source)
  act(() => useThemeStore.setState({ themeMode: "dark" }))
  expect(capture.props.style).toBe(oneDark)
  expect(host.textContent).toBe(source)
  act(() => root.unmount())
})

it("keeps representative light syntax tokens above 4.5:1 on the light card", () => {
  const luminance = (hex: string) => {
    const channels = hex.replace("#", "").match(/../g)!.map((part) => parseInt(part, 16) / 255)
      .map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
  }
  for (const token of ["comment", "string", "keyword", "number", "boolean", "operator", "punctuation"]) {
    const color = coldarkCold[token]?.color
    expect(typeof color).toBe("string")
    expect((1.05) / (luminance(String(color)) + 0.05), token).toBeGreaterThanOrEqual(4.5)
  }
})
