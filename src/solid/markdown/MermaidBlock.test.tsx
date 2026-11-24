import { render } from "@solidjs/web"
import { createSignal, flush } from "solid-js"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { AssistantMarkdown } from "./AssistantMarkdown"
import type { MermaidTheme } from "../../lib/mermaid/strictConfig"
import { englishMarkdownText } from "./text"

const mermaid = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }))
vi.mock("mermaid", () => ({ default: mermaid }))

const mounts: (() => void)[] = []
const urls = new Map<string, Blob>()
const createObjectURL = vi.fn((blob: Blob) => {
  const url = `blob:mermaid-fixture-${urls.size + 1}`
  urls.set(url, blob)
  return url
})
const revokeObjectURL = vi.fn()

beforeEach(() => {
  urls.clear()
  mermaid.render.mockReset()
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = createObjectURL
    static revokeObjectURL = revokeObjectURL
  })
})
afterEach(() => {
  for (const unmount of mounts.splice(0)) unmount()
})

function mount(source: string) {
  const [code, setCode] = createSignal(source)
  const [theme, setTheme] = createSignal<MermaidTheme>("light")
  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(() => <AssistantMarkdown theme={theme()}>
    {`\`\`\`mermaid\n${code()}\n\`\`\``}
  </AssistantMarkdown>, host)
  mounts.push(() => { dispose(); host.remove() })
  flush()
  return {
    host,
    changeCode: (next: string) => { setCode(next); flush() },
    changeTheme: (next: MermaidTheme) => { setTheme(next); flush() },
    button: (text: string) => [...host.querySelectorAll("button")].find((button) => button.textContent === text)!,
  }
}

const svg = (label: string) => ({ svg: `<svg xmlns="http://www.w3.org/2000/svg"><text>${label}</text></svg>` })
const ready = '[data-mermaid-state="ready"] img'
const loading = '[data-mermaid-state="loading"]'
const error = '[data-mermaid-state="error"]'
async function waitFor(assert: () => void) {
  await vi.waitFor(() => { flush(); assert() })
}
async function imageMarkup(host: HTMLElement) {
  await waitFor(() => expect(host.querySelector(ready)).not.toBeNull())
  const img = host.querySelector<HTMLImageElement>(ready)!
  expect(img.alt).toBe(englishMarkdownText("mermaid_diagram_2a0d4106"))
  expect(host.querySelector("svg")).toBeNull()
  const blob = urls.get(img.getAttribute("src")!)!
  expect(blob.type).toBe("image/svg+xml")
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

it("uses the frozen strict app policy and publishes valid output in an isolated image document", async () => {
  const source = "flowchart LR\nA[Safe chart]"
  mermaid.render.mockResolvedValueOnce(svg("Safe chart"))
  const { host } = mount(source)
  expect(await imageMarkup(host)).toContain("Safe chart")
  expect(mermaid.initialize).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    startOnLoad: false, securityLevel: "strict", htmlLabels: false, flowchart: { htmlLabels: false }, theme: "default",
  }))
  expect(mermaid.render).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/^solid-app-diagram-\d+$/), source + "\n")
})

it("shows an accessible error and escaped source when the chart is malformed", async () => {
  const source = 'flowchart LR\nA[<img src=x onerror="alert(1)">'
  mermaid.render.mockRejectedValueOnce(new Error("parse failed"))
  const { host } = mount(source)
  await waitFor(() => expect(host.querySelector(error)).not.toBeNull())
  const failure = host.querySelector(error)!
  expect(failure.querySelector('[role="alert"]')?.textContent?.trim())
    .toBe(englishMarkdownText("could_not_render_mermaid_diagram_c26105d4"))
  expect(failure.querySelector("[data-mermaid-source]")?.textContent).toBe(source + "\n")
  expect(failure.querySelector("img, script, [onerror]")).toBeNull()
  expect(failure.textContent).toContain("parse failed")
})

it("withdraws the previous image as soon as new source starts rendering", async () => {
  mermaid.render.mockResolvedValueOnce(svg("Old chart"))
  const view = mount("flowchart LR\nA[Old]")
  expect(await imageMarkup(view.host)).toContain("Old chart")
  const oldUrl = view.host.querySelector(ready)?.getAttribute("src")
  mermaid.render.mockResolvedValueOnce(svg("New chart"))
  view.changeCode("flowchart LR\nB[New]")
  expect(view.host.querySelector(ready)).toBeNull()
  expect(view.host.querySelector(loading)).not.toBeNull()
  expect(revokeObjectURL).toHaveBeenCalledWith(oldUrl)
  expect(await imageMarkup(view.host)).toContain("New chart")
})

it("updates the app theme and drops a themed image superseded before it was ready", async () => {
  mermaid.render.mockResolvedValueOnce(svg("Original light"))
  const view = mount("flowchart LR\nA[Theme]")
  expect(await imageMarkup(view.host)).toContain("Original light")
  let finishDark!: (value: ReturnType<typeof svg>) => void
  mermaid.render.mockReturnValueOnce(new Promise((resolve) => { finishDark = resolve }))
  view.changeTheme("dark")
  expect(view.host.querySelector(ready)).toBeNull()
  await waitFor(() => expect(mermaid.initialize).toHaveBeenLastCalledWith(expect.objectContaining({
    theme: "dark", securityLevel: "strict",
  })))
  mermaid.render.mockResolvedValueOnce(svg("Current light"))
  view.changeTheme("light")
  finishDark(svg("Stale dark"))
  expect(await imageMarkup(view.host)).toContain("Current light")
  expect(createObjectURL).toHaveBeenCalledTimes(2)
  expect(mermaid.initialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: "default", securityLevel: "strict" }))
})

it("retries, keeps Escape IME-safe, repairs the local preview, restores the original, and resets on source change", async () => {
  const original = "flowchart LR\nA[Broken"
  mermaid.render.mockRejectedValueOnce(new Error("Visible parse error"))
  const view = mount(original)
  const { host } = view
  await waitFor(() => expect(host.querySelector(error)).not.toBeNull())
  mermaid.render.mockRejectedValueOnce(new Error("Still invalid"))
  view.button(englishMarkdownText("mermaid_render_again")).click()
  await waitFor(() => expect(host.textContent).toContain("Still invalid"))
  expect(mermaid.render).toHaveBeenLastCalledWith(expect.any(String), original + "\n")

  view.button(englishMarkdownText("mermaid_edit_source")).click()
  flush()
  const editor = host.querySelector("textarea")!
  for (const ime of [{ isComposing: true }, { keyCode: 229 }]) {
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, ...ime }))
    flush()
    expect(host.querySelector("textarea")).toBe(editor)
  }
  const corrected = "flowchart LR\nA[Repaired] --> B[Done]"
  editor.value = corrected
  editor.dispatchEvent(new Event("input", { bubbles: true }))
  flush()
  mermaid.render.mockResolvedValueOnce(svg("Repaired chart"))
  editor.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  expect(await imageMarkup(host)).toContain("Repaired chart")
  expect(mermaid.render).toHaveBeenLastCalledWith(expect.any(String), corrected)
  expect(host.querySelector("textarea")).toBeNull()

  mermaid.render.mockRejectedValueOnce(new Error("Original still invalid"))
  view.button(englishMarkdownText("mermaid_restore_original")).click()
  await waitFor(() => expect(host.querySelector("[data-mermaid-source]")?.textContent).toBe(original + "\n"))
  mermaid.render.mockResolvedValueOnce(svg("Updated message"))
  view.changeCode("flowchart LR\nA[Updated message]")
  expect(await imageMarkup(host)).toContain("Updated message")
  expect(host.textContent).not.toContain(englishMarkdownText("mermaid_restore_original"))
})
