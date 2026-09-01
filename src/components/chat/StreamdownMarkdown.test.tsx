import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const { highlightCode, renderDeferredMermaid } = vi.hoisted(() => ({
  highlightCode: vi.fn(),
  renderDeferredMermaid: vi.fn(),
}))

vi.mock("@streamdown/code", () => ({
  code: {
    name: "shiki",
    type: "code-highlighter",
    getSupportedLanguages: () => ["typescript"],
    getThemes: () => ["github-light", "github-dark"],
    supportsLanguage: () => true,
    highlight: ({ code, themes }: { code: string; themes: [unknown, unknown] }) => {
      highlightCode({ code, themes })
      return {
        bg: "transparent",
        fg: "inherit",
        tokens: code.split("\n").map((line) => [{ content: line, color: "inherit" }]),
      }
    },
  },
}))

vi.mock("./StreamdownMermaid", () => ({
  default: ({ code }: { code: string }) => {
    renderDeferredMermaid(code)
    return <div data-testid="completed-mermaid">{code}</div>
  },
}))

import { StreamdownMarkdown } from "./StreamdownMarkdown"
import { useThemeStore } from "@/shared/store/themeStore"

type MountedMarkdown = {
  container: HTMLDivElement
  render: (source: string, isStreaming: boolean) => Promise<void>
}

function semanticHtml(container: HTMLElement): string {
  const clone = container.cloneNode(true) as HTMLElement
  for (const node of clone.querySelectorAll<HTMLElement>("[style]")) {
    if (!node.getAttribute("style")) node.removeAttribute("style")
  }
  return clone.innerHTML
}

const mountedRoots: Root[] = []
const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

beforeAll(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => {
  Reflect.deleteProperty(reactActEnvironment, "IS_REACT_ACT_ENVIRONMENT")
})

beforeEach(() => {
  document.documentElement.classList.remove("dark")
})

afterEach(() => {
  for (const root of mountedRoots.splice(0)) act(() => root.unmount())
  document.body.replaceChildren()
  document.documentElement.classList.remove("dark")
  useThemeStore.setState({ themePreference: "system", themeMode: "light" })
})

function applyResolvedAppTheme(
  themePreference: "light" | "dark" | "system",
  themeMode: "light" | "dark",
): void {
  // App.tsx receives a resolved light/dark mode from this store even when the
  // persisted preference is "system", then exposes it through the root class.
  useThemeStore.setState({ themePreference, themeMode })
  document.documentElement.classList.toggle("dark", themeMode === "dark")
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
  })
}

async function mountMarkdown(source = "", isStreaming = false): Promise<MountedMarkdown> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  mountedRoots.push(root)

  const render = async (nextSource: string, nextIsStreaming: boolean) => {
    await act(async () => {
      root.render(
        <StreamdownMarkdown isStreaming={nextIsStreaming}>{nextSource}</StreamdownMarkdown>,
      )
    })
    await settle()
  }

  await render(source, isStreaming)
  return { container, render }
}

describe("StreamdownMarkdown streaming behavior", () => {
  it("does not invoke the code plugin for prose or inline code", async () => {
    highlightCode.mockClear()
    const view = await mountMarkdown("ordinary prose with `inline code`", true)

    expect(highlightCode).not.toHaveBeenCalled()
    await view.render("ordinary prose completed", false)
    expect(highlightCode).not.toHaveBeenCalled()
  })

  it("repairs incomplete inline and block Markdown across successive updates", async () => {
    const view = await mountMarkdown("This is **bo", true)
    expect(view.container.querySelector('[data-streamdown="strong"]')?.textContent).toBe("bo")

    await view.render("This is **bold**", true)
    expect(view.container.querySelector('[data-streamdown="strong"]')?.textContent).toBe("bold")

    await view.render("- first\n- sec", true)
    expect([...view.container.querySelectorAll("li")].map((node) => node.textContent)).toEqual([
      "first",
      "sec",
    ])
    await view.render("- first\n- second", true)
    expect(view.container.querySelectorAll("li")).toHaveLength(2)

    await view.render("| Key | Value |\n| --- | --- |\n| path | /very/long", true)
    expect(view.container.querySelector('[data-streamdown="table"]')?.textContent).toContain(
      "/very/long",
    )
    await view.render("| Key | Value |\n| --- | --- |\n| path | /very/long/path |", true)
    expect(view.container.querySelectorAll("td")).toHaveLength(2)

    await view.render("[Open](https://exam", true)
    expect(view.container.textContent).toContain("Open")
    expect(view.container.textContent).not.toContain("](https://")
    await view.render("[Open](https://example.com)", true)
    expect(view.container.querySelector('[data-streamdown="link"]')?.textContent).toBe("Open")

    await view.render("Use `path/to/fi", true)
    expect(view.container.querySelector('[data-streamdown="inline-code"]')?.textContent).toBe(
      "path/to/fi",
    )
    await view.render("Use `path/to/file`", true)
    expect(view.container.querySelector('[data-streamdown="inline-code"]')?.textContent).toBe(
      "path/to/file",
    )

    await view.render("```\n/a/very/long/path", true)
    expect(
      view.container
        .querySelector('[data-streamdown="code-block"]')
        ?.hasAttribute("data-incomplete"),
    ).toBe(true)
    await view.render("```\n/a/very/long/path\n```", true)
    expect(
      view.container.querySelector('[data-streamdown="code-block"]')?.hasAttribute("data-incomplete"),
    ).toBe(false)
  })

  it("supports GFM, CJK adjacency, tagged and untagged code without enabling math", async () => {
    const source = [
      "这是**重点**，也是~~删除~~。",
      "",
      "- [x] complete",
      "- [ ] pending",
      "",
      "| 列 | Value |",
      "| --- | --- |",
      "| 中文 | ok |",
      "",
      "```typescript",
      "const path = '/a/very/long/path'",
      "```",
      "",
      "```",
      "plain fence",
      "```",
      "",
      "$not-math$",
    ].join("\n")
    const view = await mountMarkdown(source, false)

    await vi.waitFor(() => expect(highlightCode).toHaveBeenCalled())
    expect(view.container.querySelector('[data-streamdown="strong"]')?.textContent).toBe("重点")
    expect(view.container.querySelector("del")?.textContent).toBe("删除")
    expect(view.container.querySelectorAll('input[type="checkbox"]')).toHaveLength(2)
    expect(view.container.querySelector('[data-streamdown="table"]')).not.toBeNull()
    expect(view.container.querySelectorAll('[data-streamdown="code-block"]')).toHaveLength(2)
    expect(view.container.querySelector(".katex")).toBeNull()
    expect(view.container.textContent).toContain("$not-math$")
  })

  it("defers Mermaid across incomplete updates and loads it only after the fence closes", async () => {
    const view = await mountMarkdown("```mermaid\nflowchart LR\nA[", true)

    expect(view.container.querySelector('[data-mermaid-state="incomplete"]')).not.toBeNull()
    expect(renderDeferredMermaid).not.toHaveBeenCalled()

    await view.render("```mermaid\nflowchart LR\nA[open", true)
    expect(view.container.querySelector('[data-mermaid-state="incomplete"]')).not.toBeNull()
    expect(renderDeferredMermaid).not.toHaveBeenCalled()

    await view.render("```mermaid\nflowchart LR\nA[open]\n```", true)
    await vi.waitFor(() => expect(renderDeferredMermaid).toHaveBeenCalledTimes(1))
    expect(view.container.querySelector('[data-testid="completed-mermaid"]')?.textContent).toContain(
      "A[open]",
    )
  })

  it("animates only the active form and converges to the same deterministic static DOM", async () => {
    const finalSource = "一段 **final** text\n\n- one\n- two"
    const transitioning = await mountMarkdown(finalSource, true)

    expect(transitioning.container.querySelector("[data-sd-animate]")).not.toBeNull()
    expect(transitioning.container.innerHTML).toContain("--streamdown-caret")

    await transitioning.render(finalSource, false)
    expect(transitioning.container.querySelector("[data-sd-animate]")).toBeNull()
    expect(transitioning.container.innerHTML).not.toContain("--streamdown-caret")
    const transitionedStaticDom = semanticHtml(transitioning.container)

    const persisted = await mountMarkdown(finalSource, false)
    expect(semanticHtml(persisted.container)).toBe(transitionedStaticDom)
  })
})

describe("StreamdownMarkdown security, layout and theme semantics", () => {
  it("keeps raw HTML out of the DOM and rejects unsafe Markdown URLs and attributes", async () => {
    const source = [
      '<script id="raw-script">alert(1)</script>',
      '<img id="raw-image" src="https://evil.example/x" onerror="alert(2)">',
      '<a id="raw-link" href="javascript:alert(3)" onclick="alert(4)">raw</a>',
      '<b id="host-clobber">bold raw text</b>',
      "",
      "[unsafe](javascript:alert(5))",
      "![unsafe image](data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+)",
      "",
      "[safe link](https://example.com/path)",
      "",
      "![safe image](https://example.com/image.png)",
    ].join("\n")
    const view = await mountMarkdown(source, false)

    expect(view.container.querySelector("script")).toBeNull()
    expect(view.container.querySelector("#raw-image")).toBeNull()
    expect(view.container.querySelector("#raw-link")).toBeNull()
    expect(view.container.querySelector("#host-clobber")).toBeNull()
    expect(view.container.querySelector("[onerror], [onclick]")).toBeNull()
    expect(view.container.querySelector('img[src^="data:"]')).toBeNull()
    expect(view.container.querySelector('[href^="javascript:"]')).toBeNull()
    expect(view.container.querySelector('[data-streamdown="link"]')?.textContent).toContain(
      "safe link",
    )
    expect(view.container.querySelector<HTMLImageElement>('[data-streamdown="image"]')?.src).toBe(
      "https://example.com/image.png",
    )
  })

  it("exposes responsive contracts and follows the existing dark theme class", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 })
    highlightCode.mockClear()
    const source = [
      "[超长 URL](https://example.com/a/very/long/path/without/a/breakpoint)",
      "",
      "| Shared path | Value |",
      "| --- | --- |",
      "| /a/very/long/path/without/a/breakpoint | 中文内容 |",
      "",
      "```text",
      "/a/very/long/path/without/a/breakpoint",
      "```",
    ].join("\n")
    applyResolvedAppTheme("light", "light")
    const view = await mountMarkdown(source, false)
    const root = view.container.firstElementChild
    const lightDom = semanticHtml(view.container)

    expect(window.innerWidth).toBe(320)
    expect(document.documentElement.classList.contains("dark")).toBe(false)
    expect(root?.className).toContain("assistant-streamdown")
    expect(root?.className).toContain("min-w-0")
    expect(root?.className).toContain("max-w-none")
    expect(root?.className).toContain("[overflow-wrap:anywhere]")
    expect(root?.className).toContain("dark:prose-invert")
    expect(
      view.container.querySelector('[data-streamdown="table-wrapper"] > div')?.className,
    ).toContain("overflow-x-auto")
    expect(view.container.querySelector('[data-streamdown="table-header-cell"]')).not.toBeNull()
    expect(view.container.querySelector('[data-streamdown="code-block-body"]')).not.toBeNull()

    await vi.waitFor(() =>
      expect(highlightCode).toHaveBeenCalledWith({
        code: "/a/very/long/path/without/a/breakpoint",
        themes: ["github-light", "github-dark"],
      }),
    )

    // Explicit dark and both possible system-resolved modes cross the same
    // App.tsx class boundary; Markdown semantics and Shiki's dual themes stay
    // stable while CSS selects the visible palette.
    applyResolvedAppTheme("dark", "dark")
    await view.render(source, false)
    expect(document.documentElement.classList.contains("dark")).toBe(true)
    expect(semanticHtml(view.container)).toBe(lightDom)

    applyResolvedAppTheme("system", "light")
    await view.render(source, false)
    expect(useThemeStore.getState()).toMatchObject({
      themePreference: "system",
      themeMode: "light",
    })
    expect(document.documentElement.classList.contains("dark")).toBe(false)
    expect(semanticHtml(view.container)).toBe(lightDom)

    applyResolvedAppTheme("system", "dark")
    await view.render(source, false)
    expect(useThemeStore.getState()).toMatchObject({
      themePreference: "system",
      themeMode: "dark",
    })
    expect(document.documentElement.classList.contains("dark")).toBe(true)
    expect(semanticHtml(view.container)).toBe(lightDom)
  })
})
