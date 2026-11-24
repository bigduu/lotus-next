import { render } from "@solidjs/web"
import { flush } from "solid-js"
import { expect, it, vi } from "vitest"
import { CodeBlock } from "./CodeBlock"
import { highlightCode } from "./highlight/highlightCode"

function luminance(hex: string) {
  const values = hex.slice(1).match(/../g)!.map((channel) => parseInt(channel, 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  return values[0]! * 0.2126 + values[1]! * 0.7152 + values[2]! * 0.0722
}

it("preserves the code and publishes both syntax palettes when highlighting completes", async () => {
  const host = document.createElement("div")
  const source = 'const message = "中文";\n' + "long_value".repeat(100)
  const dispose = render(() => <CodeBlock language="typescript" code={source} incomplete={false} />, host)
  try {
    flush()
    expect(host.querySelector("code")?.textContent).toBe(source)
    await vi.waitFor(() => {
      flush()
      const token = host.querySelector<HTMLElement>("[data-solid-code-token]")
      expect(token?.textContent).toBe("const")
      const light = token!.style.getPropertyValue("--lotus-code-color-light")
      const dark = token!.style.getPropertyValue("--lotus-code-color-dark")
      expect(light).toMatch(/^#[a-f0-9]{6}$/i)
      expect(dark).toMatch(/^#[a-f0-9]{6}$/i)
      expect(light).not.toBe(dark)
    })
    expect(host.querySelector("code")?.textContent).toBe(source)
  } finally {
    dispose()
  }
})

it("keeps representative Shiki light syntax tokens above 4.5:1 against white", async () => {
  const source = '/* note */\nconst flag = true; const amount = 42 + 5;\nconst message = "中文";'
  const tokens = (await highlightCode(source, "typescript")).flat()
  for (const content of ["/* note */", '"中文"', "const", "42", "true", "+", ";"]) {
    const color = tokens.find((token) => token.content === content)?.htmlStyle?.color
    expect(color, content).toMatch(/^#[a-f0-9]{6}$/i)
    expect(1.05 / (luminance(color!) + 0.05), content).toBeGreaterThanOrEqual(4.5)
  }
})
