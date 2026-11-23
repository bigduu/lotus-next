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
