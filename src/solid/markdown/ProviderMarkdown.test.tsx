import { render } from "@solidjs/web"
import { createSignal, flush } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"
import { AssistantMarkdown } from "./AssistantMarkdown"

// The checked browser artifact renders the real icons. Vitest resolves this
// package through its server entry in jsdom.
vi.mock("@lucide/solid", () => ({
  ChevronRight: () => document.createElement("span"),
  Globe: () => document.createElement("span"),
}))

const mounted: (() => void)[] = []
const content = ".assistant-streamdown"
const live = "assistant-streamdown-streaming"
const pending = '[data-provider-tool-state="streaming"]'
const tool = '[data-provider-tool="analyze_image"]'

function mount(source: string, streaming: boolean) {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })))
  const host = document.createElement("div")
  document.body.append(host)
  const [snapshot, setSnapshot] = createSignal({ source, streaming })
  const dispose = render(() => (
    <AssistantMarkdown isStreaming={snapshot().streaming}>{snapshot().source}</AssistantMarkdown>
  ), host)
  mounted.push(() => { dispose(); host.remove() })
  flush()
  return {
    host,
    update: (source: string, streaming: boolean) => { setSnapshot({ source, streaming }); flush() },
  }
}

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount()
})

it("folds complete provider inputs and only reveals the following prose tail", () => {
  const source = [
    "Before", "", "**🌐 Z.ai Built-in Tool: analyze_image**",
    "**Input:** hidden input", "**Output:** safe result", "",
    "After **still streaming",
  ].join("\n")
  const { host } = mount(source, true)
  const prose = [...host.querySelectorAll(content)]
  expect(prose.map((node) => node.textContent)).toEqual(["Before", "After still streaming"])
  expect(prose.map((node) => node.classList.contains(live))).toEqual([false, true])
  expect(host.textContent).not.toContain("hidden input")
  expect(prose.some((node) => node.textContent?.includes("Built-in Tool"))).toBe(false)

  const toggle = host.querySelector<HTMLButtonElement>(`${tool} button`)!
  expect(toggle.getAttribute("aria-expanded")).toBe("false")
  toggle.click()
  flush()
  expect(toggle.getAttribute("aria-expanded")).toBe("true")
  expect(host.querySelector(`${tool} ${content}`)?.textContent).toContain("hidden input")
  expect(host.querySelector(`${tool} ${content}`)?.textContent).toContain("safe result")
  toggle.click()
  flush()
  expect(host.textContent).not.toContain("hidden input")
})

it("keeps a partial provider input out of the live DOM until an explicit expansion", () => {
  const partial = [
    "Stable introduction", "", "**🌐 Z.ai Built-in Tool: web_search**", "**Input:** signed-secret-url",
  ].join("\n")
  const view = mount(partial, true)
  const status = view.host.querySelector(pending)
  expect(status?.getAttribute("role")).toBe("status")
  expect(status?.textContent).toContain("web_search")
  expect(view.host.querySelector(content)?.textContent).toBe("Stable introduction")
  expect(view.host.querySelector(content)?.classList.contains(live)).toBe(false)
  expect(view.host.textContent).not.toContain("Built-in Tool")
  expect(view.host.textContent).not.toContain("signed-secret-url")

  view.update(partial + "\n**Output:** finished\n\nContinuing now", true)
  expect(view.host.querySelector(pending)).toBeNull()
  expect(view.host.querySelector('[data-provider-tool="web_search"]')?.textContent).toContain("web_search")
  expect(view.host.querySelector(`.${live}`)?.textContent).toBe("Continuing now")
  expect(view.host.textContent).not.toContain("signed-secret-url")
})

it.each([
  "**🌐 Z.ai Buil", "**🌐 Z.ai Built-in Tool:", "**🌐 Z.ai Built-in Tool: web_se",
])("withholds a token-partial decorated provider header: %s", (header) => {
  const { host } = mount(`Stable introduction\n\n${header}`, true)
  expect(host.querySelector(pending)?.getAttribute("role")).toBe("status")
  expect(host.querySelector(content)?.textContent).toBe("Stable introduction")
  expect(host.querySelector(content)?.classList.contains(live)).toBe(false)
  expect(host.textContent).not.toContain(header)
})

it("renders a malformed persisted marker as ordinary prose", () => {
  const malformed = "Built-in Tool: example\nInput without a complete Output marker"
  const { host } = mount(malformed, false)
  expect(host.querySelector(pending)).toBeNull()
  expect(host.querySelector(content)?.textContent).toBe(malformed)
})

it("keeps an undecorated prose mention of a built-in tool visible during streaming", () => {
  const prose = "Documentation may say Built-in Tool: example without invoking one."
  const { host } = mount(prose, true)
  expect(host.querySelector(pending)).toBeNull()
  expect(host.querySelector(content)?.textContent).toBe(prose)
})

const inlineTool = '[data-provider-tool="edit_sample"]'
const script = "# This is a script comment\n\n# Another comment\n<sample>literal text</sample>"

it("folds inline function arguments on replay and renders their expanded source literally", () => {
  const source = `<function=edit_sample><parameter=text>\n${script}\n</parameter></function>`
  const { host } = mount(`Preparing the sample:${source}\n\n## Actual heading`, false)
  expect(host.querySelector(content)?.textContent).toBe("Preparing the sample:")
  expect([...host.querySelectorAll("h1,h2")].map((heading) => heading.textContent)).toEqual(["Actual heading"])
  expect(host.textContent).not.toContain("This is a script comment")

  const toggle = host.querySelector<HTMLButtonElement>(`${inlineTool} button`)!
  expect(toggle.getAttribute("aria-expanded")).toBe("false")
  toggle.click()
  flush()
  expect(host.querySelector(`${inlineTool} pre`)?.textContent).toBe(source)
  expect(host.querySelector(`${inlineTool} sample, ${inlineTool} h1`)).toBeNull()
})

it("folds an incoming tool payload through streaming, completion, and a truncated replay", () => {
  const intro = "Preparing the sample"
  const view = mount(`${intro}\n\n<tool_call>\n<function=edit_`, true)
  expect(view.host.querySelector(pending)?.getAttribute("role")).toBe("status")
  expect(view.host.querySelector(content)?.textContent).toBe(intro)
  expect(view.host.textContent).not.toContain("<function=")

  const incomplete = `${intro}\n\n<tool_call>\n<function=edit_sample>\n<parameter=text>\n${script}`
  view.update(incomplete, true)
  expect(view.host.querySelector(inlineTool)).not.toBeNull()
  expect(view.host.textContent).not.toContain("This is a script comment")

  view.update(`${incomplete}\n</parameter>\n</function>\n</tool_call>\n\nStill **writing`, true)
  expect(view.host.querySelector(`.${live}`)?.textContent).toBe("Still writing")
  expect(view.host.querySelectorAll(inlineTool)).toHaveLength(1)

  view.update(incomplete, false)
  expect(view.host.querySelector(inlineTool)).not.toBeNull()
  expect(view.host.querySelector("h1")).toBeNull()
})

it("restores prose and both tool disclosures around adjacent calls", () => {
  const first = "<function=edit_sample><parameter=text>first</parameter></function>"
  const second = "<tool_call>\n<function=read_sample>\n</function>\n</tool_call>"
  const { host } = mount(`Before ${first} In between ${second}\n\nAfter`, false)
  expect([...host.querySelectorAll(content)].map((node) => node.textContent)).toEqual(["Before", "In between", "After"])
  expect([...host.querySelectorAll("[data-provider-tool]")].map((node) => node.getAttribute("data-provider-tool")))
    .toEqual(["edit_sample", "read_sample"])
})

it("keeps literal closing tags inside streamed and saved parameter values", () => {
  const partial = [
    "<tool_call>", "<function=edit_sample>", "<parameter=before>",
    'print("</function>")', "# First script comment",
  ].join("\n")
  const view = mount(partial, true)
  expect(view.host.textContent).not.toContain("First script comment")

  const call = [
    partial, "</parameter>", "<parameter=after>",
    'print("</parameter>")', 'print("</tool_call>")', "# Second script comment",
    "</parameter>", "</function>", "</tool_call>",
  ].join("\n")
  view.update(`${call}\n\n## Actual heading`, false)
  expect([...view.host.querySelectorAll("h1,h2")].map((heading) => heading.textContent)).toEqual(["Actual heading"])

  view.host.querySelector<HTMLButtonElement>(`${inlineTool} button`)!.click()
  flush()
  expect(view.host.querySelector(`${inlineTool} pre`)?.textContent).toBe(call)
})

it.each([">", "> >"])("preserves indented code in a blockquote starting with %s", (quote) => {
  const example = "<function=edit_sample><parameter=text>example</parameter></function>"
  const { host } = mount(`${quote}     ${example}`, false)
  expect(host.querySelector(inlineTool)).toBeNull()
  expect(host.querySelector("blockquote pre")?.textContent).toContain(example)
})

it.each([
  ["```xml", "> ```", "", "```"],
  ["> ```xml", "> > ```", "> ", "> ```"],
  ["1. ```xml", "   - ```", "   ", "   ```"],
  ["- > ```xml", "  > > ```", "  > ", "  > ````"],
])("keeps fence-like text inside %s in the original code block", (open, literal, prefix, close) => {
  const example = "<function=edit_sample><parameter=text>example</parameter></function>"
  const source = [open, literal, `${prefix}${example}`, close, "", "<function=read_sample></function>"].join("\n")
  const { host } = mount(source, false)
  expect(host.querySelector(inlineTool)).toBeNull()
  expect(host.querySelector("pre")?.textContent).toContain(example)
  expect(host.querySelector('[data-provider-tool="read_sample"]')).not.toBeNull()
})

it("finds a tool call after an implicitly closed quoted fence", () => {
  const source = "> ```xml\n> Quoted code\n\n<function=read_sample></function>"
  const { host } = mount(source, false)
  expect(host.querySelector("blockquote pre")?.textContent).toContain("Quoted code")
  expect(host.querySelector('[data-provider-tool="read_sample"]')).not.toBeNull()
})

it("keeps quoted protocol examples and ordinary marker mentions in Markdown", () => {
  const example = "<function=edit_sample><parameter=text>example</parameter></function>"
  const source = [
    `The literal syntax is \`${example}\`.`, "",
    "> ```xml", `> ${example}`, "> ```", "",
    `    ${example}`, "",
    "Use <function=edit_sample> to name the example.", "",
    `\\${example}`,
  ].join("\n")
  const { host } = mount(source, false)
  expect(host.querySelectorAll(inlineTool)).toHaveLength(0)
  expect(host.querySelector('[data-streamdown="inline-code"]')?.textContent).toBe(example)
  expect(host.querySelector("blockquote pre")?.textContent).toContain(example)
  expect(host.textContent).toContain("Use <function=edit_sample> to name the example.")
})
