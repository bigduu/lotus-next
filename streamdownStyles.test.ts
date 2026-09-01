import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const styles = readFileSync(path.resolve(process.cwd(), "src/index.css"), "utf8")
const componentLayerMarker = "@layer components {"
const componentLayerStart = styles.indexOf(componentLayerMarker)
const componentLayerEnd = styles.indexOf("\n}\n\n@media", componentLayerStart)
const componentRules = styles.slice(
  componentLayerStart + componentLayerMarker.length,
  componentLayerEnd,
)

describe("assistant Streamdown production styles", () => {
  it.each(["streamdown", "@streamdown/code", "@streamdown/mermaid", "@streamdown/cjk"])(
    "includes the Tailwind v4 source for %s",
    (packageName) => {
      expect(styles).toContain(`@source "../node_modules/${packageName}/dist/*.js"`)
    },
  )

  it("keeps table, code, URL, CJK and reduced-motion behavior responsive", () => {
    expect(styles).toContain('.assistant-streamdown [data-streamdown="link"]')
    expect(styles).toContain('.assistant-streamdown [data-streamdown="table-wrapper"]')
    expect(styles).toContain('.assistant-streamdown [data-streamdown="table-header-cell"]')
    expect(styles).toContain('.assistant-streamdown [data-streamdown="code-block-body"]')
    expect(styles).toContain("line-break: auto")
    expect(styles).toContain("overflow-wrap: anywhere")
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)")
  })

  it("applies the narrow-width overflow and wrapping contract through CSSOM", () => {
    const style = document.createElement("style")
    style.textContent = componentRules
    document.head.appendChild(style)

    const root = document.createElement("div")
    root.className = "assistant-streamdown"
    root.style.width = "320px"
    root.innerHTML = `
      <a data-streamdown="link">long URL</a>
      <div data-streamdown="table-wrapper"><div><table data-streamdown="table"><tbody><tr>
        <th data-streamdown="table-header-cell">Shared path</th>
        <td data-streamdown="table-cell">/a/very/long/path/without/a/breakpoint</td>
      </tr></tbody></table></div></div>
      <div data-streamdown="code-block"><div data-streamdown="code-block-body"><pre><code>/a/very/long/path</code></pre></div></div>
      <img data-streamdown="image" />
    `
    document.body.appendChild(root)

    const link = root.querySelector<HTMLElement>('[data-streamdown="link"]')
    const table = root.querySelector<HTMLElement>('[data-streamdown="table"]')
    const tableScroller = root.querySelector<HTMLElement>(
      '[data-streamdown="table-wrapper"] > div',
    )
    const header = root.querySelector<HTMLElement>('[data-streamdown="table-header-cell"]')
    const codeBody = root.querySelector<HTMLElement>('[data-streamdown="code-block-body"]')
    const code = codeBody?.querySelector<HTMLElement>("code") ?? null
    const image = root.querySelector<HTMLElement>('[data-streamdown="image"]')

    expect(getComputedStyle(root).minWidth).toBe("0")
    expect(getComputedStyle(link!).overflowWrap).toBe("anywhere")
    expect(getComputedStyle(tableScroller!).overflowX).toBe("auto")
    expect(getComputedStyle(table!).minWidth).toBe("100%")
    expect(getComputedStyle(header!).whiteSpace).toBe("normal")
    expect(getComputedStyle(codeBody!).overflowX).toBe("hidden")
    expect(getComputedStyle(code!).whiteSpace).toBe("pre-wrap")
    expect(getComputedStyle(image!).maxWidth).toBe("100%")

    root.remove()
    style.remove()
  })

  it("does not add the out-of-scope math plugin source", () => {
    expect(styles).not.toContain("@streamdown/math")
  })
})
