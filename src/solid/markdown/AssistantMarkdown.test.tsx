import { render } from "@solidjs/web"
import { createSignal, flush } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { themeStore } from "@shared/store/themeState"
import { markdownTheme } from "@/lib/markdown/theme"
import { AssistantMarkdown } from "./AssistantMarkdown"
import { englishMarkdownText } from "./text"

const { highlightCode, renderMermaid } = vi.hoisted(() => ({
  highlightCode: vi.fn(async (source: string) => source.split("\n").map((content) => [{ content, color: "inherit" }])),
  renderMermaid: vi.fn(async () => '<svg xmlns="http://www.w3.org/2000/svg"/>'),
}))
vi.mock("./highlight/highlightCode", () => ({ highlightCode }))
vi.mock("./renderMermaid", () => ({ renderMermaid }))

const mounted: (() => void)[] = []

function semanticHtml(container: HTMLElement): string {
  const clone = container.cloneNode(true) as HTMLElement
  for (const node of clone.querySelectorAll<HTMLElement>("[style]")) {
    if (!node.getAttribute("style")) node.removeAttribute("style")
  }
  return clone.innerHTML
}

beforeEach(() => {
  document.documentElement.classList.remove("dark")
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })))
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = () => "blob:assistant-markdown-fixture"
    static revokeObjectURL = () => {}
  })
})
afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount()
  document.documentElement.classList.remove("dark")
  themeStore.setState({ themePreference: "system", themeMode: "light" })
})

function applyResolvedAppTheme(themePreference: "light" | "dark" | "system", themeMode: "light" | "dark") {
  themeStore.setState({ themePreference, themeMode })
  document.documentElement.classList.toggle("dark", themeMode === "dark")
}

async function settle() {
  flush()
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
  flush()
}

async function mountMarkdown(source = "", streaming = false, onOpenLink?: (url: string) => void) {
  const container = document.createElement("div")
  document.body.append(container)
  const [snapshot, set] = createSignal({ source, streaming })
  const dispose = render(() => (
    <AssistantMarkdown isStreaming={snapshot().streaming} onOpenLink={onOpenLink}>{snapshot().source}</AssistantMarkdown>
  ), container)
  mounted.push(() => { dispose(); container.remove() })
  await settle()
  return {
    container, set,
    render: async (source: string, streaming: boolean) => {
      set({ source, streaming })
      await settle()
    },
  }
}

describe("AssistantMarkdown streaming behavior", () => {
  const animatedBlocks = vi.fn(function (this: Element) {
    return { cancel: () => undefined }
  })
  let originalAnimate: PropertyDescriptor | undefined

  beforeEach(() => {
    animatedBlocks.mockClear()
    originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, "animate")
    Object.defineProperty(Element.prototype, "animate", { configurable: true, value: animatedBlocks })
  })

  afterEach(() => {
    if (originalAnimate) Object.defineProperty(Element.prototype, "animate", originalAnimate)
    else Reflect.deleteProperty(Element.prototype, "animate")
  })

  it("does not load highlighting for prose or inline code", async () => {
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
    expect(renderMermaid).not.toHaveBeenCalled()

    await view.render("```mermaid\nflowchart LR\nA[open", true)
    expect(view.container.querySelector('[data-mermaid-state="incomplete"]')).not.toBeNull()
    expect(renderMermaid).not.toHaveBeenCalled()

    await view.render("```mermaid\nflowchart LR\nA[open]\n```", true)
    await vi.waitFor(() => expect(renderMermaid).toHaveBeenCalledTimes(1))
    expect(renderMermaid).toHaveBeenCalledWith("flowchart LR\nA[open]\n", "light", expect.any(AbortSignal))
  })

  it("baselines existing text and converges to deterministic static DOM after stop", async () => {
    const finalSource = "一段 **final** text\n\n- one\n- two"
    const transitioning = await mountMarkdown(finalSource, true)

    expect(transitioning.container.querySelector("[data-assistant-reveal-chunk]")).not.toBeNull()
    expect(transitioning.container.querySelector("[data-assistant-reveal]")).toBeNull()
    expect(transitioning.container.querySelector('[data-assistant-streaming-caret]')).not.toBeNull()

    await transitioning.render(finalSource, false)
    expect(transitioning.container.querySelector("[data-assistant-reveal-chunk]")).toBeNull()
    expect(transitioning.container.querySelector('[data-assistant-streaming-caret]')).toBeNull()
    const persisted = await mountMarkdown(finalSource, false)
    expect(semanticHtml(persisted.container)).toBe(semanticHtml(transitioning.container))
  })

  it("reveals new CJK groups without replaying a growing or completed chunk", async () => {
    const prefix = "中".repeat(32)
    const view = await mountMarkdown(prefix, true)
    const first = view.container.querySelector('[data-assistant-reveal-chunk]')!
    await view.render(prefix + "你好", true)
    const chunks = [...view.container.querySelectorAll('[data-assistant-reveal-chunk]')]
    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toBe(first)
    expect(chunks[0].hasAttribute("data-assistant-reveal")).toBe(false)
    expect(chunks[1].getAttribute("data-assistant-reveal")).toBe("true")
    expect(chunks[1].textContent).toBe("你好")

    await view.render(prefix + "你好世界", true)
    const growing = view.container.querySelectorAll('[data-assistant-reveal-chunk]')[1]
    expect(growing).toBe(chunks[1])
    expect(growing.textContent).toBe("你好世界")
    expect(growing.firstChild?.nodeType).toBe(Node.TEXT_NODE)
    expect(view.container.querySelectorAll('[data-assistant-streaming-caret]')).toHaveLength(1)
    expect(view.container.textContent).toBe(prefix + "你好世界")
  })

  it("commits only the published prefix across coalesced signal updates", async () => {
    const source = "中".repeat(32)
    const view = await mountMarkdown(source, true)
    expect(view.container.querySelector("[data-assistant-reveal]")).toBeNull()
    await view.render(source + "追加", true)
    expect(view.container.querySelectorAll("[data-assistant-reveal]")).toHaveLength(1)
    expect(view.container.textContent).toBe(source + "追加")
    view.set({ source: source + "追加正", streaming: true })
    await view.render(source + "追加正文", true)
    expect(view.container.querySelectorAll("[data-assistant-reveal]")).toHaveLength(1)
    expect(view.container.textContent).toBe(source + "追加正文")
  })

  it("preserves selection inside the actively growing chunk and across completed chunks", async () => {
    const prefix = "中".repeat(32)
    const view = await mountMarkdown(prefix + "select me", true)
    const chunks = view.container.querySelectorAll('[data-assistant-reveal-chunk]')
    const tailText = chunks[1].firstChild!
    const range = document.createRange()
    range.setStart(tailText, 0)
    range.setEnd(tailText, 6)
    const selection = document.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    await view.render(prefix + "select me now", true)
    expect(selection.toString()).toBe("select")
    expect(selection.anchorNode).toBe(tailText)

    range.setStart(chunks[0].firstChild!, 30)
    range.setEnd(tailText, 6)
    selection.removeAllRanges()
    selection.addRange(range)
    const selected = selection.toString()
    await view.render(prefix + "select me now" + "文".repeat(40), true)
    expect(selection.toString()).toBe(selected)
    expect(view.container.textContent).not.toContain("\u00a0")
    selection.removeAllRanges()
  })

  it("settles old text after grammar reparenting and isolates concurrent streams", async () => {
    const first = await mountMarkdown("A title", true)
    const second = await mountMarkdown("中".repeat(32), true)
    await first.render("A title\n-------", true)
    expect(first.container.querySelector("h2")?.textContent).toBe("A title")
    expect(first.container.querySelector("[data-assistant-reveal]")).toBeNull()
    await second.render("中".repeat(32) + "追加", true)
    expect(second.container.querySelector('[data-assistant-reveal]')?.textContent).toBe("追加")
    await first.render("A title\n-------\n\nFresh paragraph", true)
    expect(animatedBlocks.mock.contexts).toEqual([first.container.querySelector("p")])
  })

  it("keeps links, code, tables and Mermaid out of prose effects", async () => {
    const view = await mountMarkdown("", true)
    const source = "Safe **正文** [link](https://example.com) `inline`\n\n```text\nfenced\n```\n\n| A | B |\n| --- | --- |\n| x | y |"
    await view.render(source, true)
    expect(animatedBlocks.mock.contexts).toEqual([view.container.querySelector("[data-assistant-reveal-chunk]")])
    for (const selector of ['[data-streamdown=link]', 'code', 'pre', 'table']) {
      expect(view.container.querySelector(`${selector} [data-assistant-reveal-chunk]`)).toBeNull()
    }
    expect(view.container.querySelector('[data-streamdown=link]')?.textContent).toBe("link")
    expect(view.container.querySelector('[aria-live]')).toBeNull()
    expect([...view.container.querySelectorAll('[data-assistant-streaming-caret]')]
      .every((node) => node.getAttribute("aria-hidden") === "true" && node.textContent === "")).toBe(true)
  })

})

describe("AssistantMarkdown security, layout and theme semantics", () => {
  it("applies shared prose, inline code, quote and table theme tokens with safe link handling", async () => {
    const onOpenLink = vi.fn()
    const source = "# Heading\n\nBody `inline` and [safe](https://example.test).\n\n> Quote\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n<script>unsafe()</script>"
    const { container } = await mountMarkdown(source, false, onOpenLink)
    const prose = container.firstElementChild as HTMLElement

    for (const [key, value] of Object.entries(markdownTheme)) expect(prose.style.getPropertyValue(key)).toBe(value)
    expect(prose.className).not.toContain("prose-invert")
    expect(prose.className).toContain("prose-headings:mt-4")
    expect(container.querySelector('[data-streamdown="inline-code"]')?.textContent).toBe("inline")
    const link = container.querySelector<HTMLAnchorElement>('a[role="link"]')!
    expect(link.getAttribute("href")).toBeNull()
    link.click()
    expect(onOpenLink).toHaveBeenCalledExactlyOnceWith("https://example.test")
    expect(container.querySelector("blockquote")?.textContent).toContain("Quote")
    expect(container.querySelector("table")).not.toBeNull()
    expect(container.querySelector("script")).toBeNull()
  })

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

  it("explains local image paths in a browser without requesting them", async () => {
    const view = await mountMarkdown("![diagram](/Users/example/diagram.png)", false)
    expect(view.container.querySelector('img[src="/Users/example/diagram.png"]')).toBeNull()
    expect(view.container.querySelector('[role="status"]')?.textContent).toContain(englishMarkdownText("local_images_cannot_be_previewed_here_9378ebfb"))
    await view.render("![file image](file:///Users/example/diagram.png)", false)
    expect(view.container.querySelector('[role="status"]')?.textContent).toContain("file image")
    await view.render("![Windows image](file:///C:/Users/example/diagram.png)", false)
    expect(view.container.querySelector('[role="status"]')?.textContent).toContain("Windows image")
    await view.render("![Windows drive](C:\\Users\\example\\diagram.png)", false)
    expect(view.container.querySelector('[role="status"]')?.textContent).toContain("Windows drive")
  })

  it("exposes responsive contracts and follows the existing dark theme class", async () => {
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
    const root = view.container.querySelector(".assistant-streamdown")

    expect(document.documentElement.classList.contains("dark")).toBe(false)
    expect(root?.className).toContain("assistant-streamdown")
    expect(root?.className).toContain("min-w-0")
    expect(root?.className).toContain("max-w-none")
    expect(root?.className).toContain("[overflow-wrap:anywhere]")
    expect((root as HTMLElement).style.getPropertyValue("--tw-prose-code")).toBe("var(--foreground)")
    expect(view.container.querySelector('[data-streamdown="table-wrapper"] > div > table')).not.toBeNull()
    expect(view.container.querySelector('[data-streamdown="table-header-cell"]')).not.toBeNull()
    const codeBlock = view.container.querySelector<HTMLElement>('[data-streamdown="code-block"]')
    const codeHeader = view.container.querySelector<HTMLElement>(
      '[data-streamdown="code-block-header"]',
    )
    const codeBody = view.container.querySelector<HTMLElement>(
      '[data-streamdown="code-block-body"]',
    )
    expect(codeBlock?.className.split(" ")).toEqual(expect.arrayContaining(["my-2", "p-1.5", "gap-1"]))
    expect(codeHeader?.className).toContain("h-5")
    expect(codeBody?.className.split(" ")).toEqual(expect.arrayContaining(["text-sm", "px-3", "py-2.5"]))
    expect(codeBody?.querySelector("pre > code")?.textContent).toBe("/a/very/long/path/without/a/breakpoint")

    await vi.waitFor(() => {
      flush()
      expect(highlightCode).toHaveBeenCalledWith("/a/very/long/path/without/a/breakpoint", "text")
      expect(view.container.querySelector("[data-solid-code-token]")).not.toBeNull()
    })
    const lightDom = semanticHtml(view.container)

    // Explicit dark and both possible system-resolved modes cross the same
    // app root class boundary; Markdown semantics and Shiki's dual themes stay
    // stable while CSS selects the visible palette.
    applyResolvedAppTheme("dark", "dark")
    await view.render(source, false)
    expect(document.documentElement.classList.contains("dark")).toBe(true)
    expect(semanticHtml(view.container)).toBe(lightDom)

    applyResolvedAppTheme("system", "light")
    await view.render(source, false)
    expect(themeStore.getState()).toMatchObject({
      themePreference: "system",
      themeMode: "light",
    })
    expect(document.documentElement.classList.contains("dark")).toBe(false)
    expect(semanticHtml(view.container)).toBe(lightDom)

    applyResolvedAppTheme("system", "dark")
    await view.render(source, false)
    expect(themeStore.getState()).toMatchObject({
      themePreference: "system",
      themeMode: "dark",
    })
    expect(document.documentElement.classList.contains("dark")).toBe(true)
    expect(semanticHtml(view.container)).toBe(lightDom)
  })
})
