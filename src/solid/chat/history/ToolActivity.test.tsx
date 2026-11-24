import { render, type JSX } from "@solidjs/web"
import { createSignal, flush } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"
import { apiClient } from "@services/api"
import { changeLocale } from "@shared/i18n/runtime"
import { appStore } from "@shared/store/appStore/state"
import { mapHistoryMessagesToUi } from "@shared/store/appStore/slices/chatSessionSlice/messageMapping"
import type { AssistantToolCallMessage, AssistantToolResultMessage, Message } from "@shared/types/chatMessages"
import { RenderHistoryRow } from "./HistoryRow"
import { ToolActivity } from "./ToolActivity"

vi.mock("@lucide/solid", () => {
  const Icon = (props: Pick<JSX.IntrinsicElements["svg"], "class" | "aria-hidden">) =>
    <svg class={props.class} aria-hidden={props["aria-hidden"]} />
  return { Brain: Icon, ChevronRight: Icon, Columns2: Icon, FileDiff: Icon, FileText: Icon, Globe: Icon, Image: Icon,
    LoaderCircle: Icon, MessageSquare: Icon, Pencil: Icon, Rows3: Icon, Search: Icon, Terminal: Icon, Wrench: Icon, WrapText: Icon }
})

const cleanup: (() => void)[] = []
afterEach(() => { for (const dispose of cleanup.splice(0)) dispose() })

const at = "2026-09-24T00:00:00Z"
const dataImage = "data:image/png;base64,aGVsbG8="
const call = (id: string, toolName = "Read", parameters: Record<string, unknown> = {}): AssistantToolCallMessage => ({
  id: `${id}-call`, role: "assistant", type: "tool_call", createdAt: at, toolCalls: [{ toolCallId: id, toolName, parameters }],
})
const result = (id: string, text: string, toolName = "Read", images?: AssistantToolResultMessage["images"]): AssistantToolResultMessage => ({
  id: `${id}-result`, role: "assistant", type: "tool_result", toolCallId: id, toolName, createdAt: at, isError: false,
  result: { tool_name: toolName, result: text, display_preference: "Default" }, images,
})
const read = () => [call("read", "Read", { file_path: "/tmp/example.ts" }), result("read", "done")]
const itemToggles = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>("[data-tool-call-entry-toggle]")]
const details = (host: HTMLElement) => host.querySelector("[data-tool-call-entry-detail]")
const click = (element: HTMLElement) => { element.click(); flush() }

function mount(messages: Message[], options: { process?: boolean; preview?: boolean; single?: boolean; running?: string[] } = {}) {
  const host = document.body.appendChild(document.createElement("div"))
  const [snapshot, setSnapshot] = createSignal({ messages, running: options.running })
  const [open, setOpen] = createSignal<ReadonlySet<string>>(new Set())
  const disclosure = {
    isOpen: (key: string) => open().has(key),
    toggle: (key: string) => setOpen((previous) => {
      const next = new Set(previous)
      if (!next.delete(key)) next.add(key)
      return next
    }),
  }
  const onPreviewImage = vi.fn()
  const part = () => ({ kind: "tools" as const, items: snapshot().messages,
    runningCallIds: snapshot().running ? new Set(snapshot().running) : undefined })
  const stop = render(() => options.process
    ? <RenderHistoryRow item={{ kind: "process", key: "test-process", parts: [part()] }} disclosure={disclosure}
        theme="light" onOpenLink={() => {}} onPreviewImage={onPreviewImage} />
    : <ToolActivity part={part()} groupKey="group" preview={options.preview} expandedSingle={options.single}
        disclosure={disclosure} onPreviewImage={onPreviewImage} />, host)
  cleanup.push(() => { stop(); host.remove() })
  flush()
  return { host, onPreviewImage,
    update(next: Message[], running?: string[]) { setSnapshot({ messages: next, running }); flush() } }
}

it("keeps the first directly inspected result visible when another call joins the Process", () => {
  const view = mount(read(), { process: true })
  const toggle = view.host.querySelector<HTMLButtonElement>("[data-process-toggle]")!
  const panel = view.host.querySelector("[data-process-content]")!
  expect(panel.getAttribute("aria-hidden")).toBe("true")
  expect(panel.hasAttribute("inert")).toBe(true)
  expect(panel.hasAttribute("hidden")).toBe(false)
  expect(itemToggles(view.host)).toHaveLength(0)
  click(toggle)
  expect(view.host.querySelector("[data-process-content]")).toBe(panel)
  expect(panel.getAttribute("aria-hidden")).toBe("false")
  expect(details(view.host)?.textContent).toContain("/tmp/example.ts")
  expect(details(view.host)?.querySelector("pre")?.textContent).toBe("done")

  view.update([...read(), call("second", "Bash")])
  const [first, second] = itemToggles(view.host)
  expect(first.getAttribute("aria-expanded")).toBe("true")
  expect(second.getAttribute("aria-expanded")).toBe("false")
  expect(details(view.host)?.querySelector("pre")?.textContent).toBe("done")
  click(first)
  expect(first.getAttribute("aria-expanded")).toBe("false")
  expect(details(view.host)).toBeNull()
  click(first)
  expect(first.getAttribute("aria-expanded")).toBe("true")
  expect(details(view.host)?.querySelector("pre")?.textContent).toBe("done")
})

it("keeps every compact tool toggle and its manual inspection across results and new calls", () => {
  const calls = (count: number) => Array.from({ length: count }, (_, index) => call(`read-${index}`, "Read", { file_path: `/tmp/file-${index}.ts` }))
  const view = mount([...calls(5), result("read-0", "partial output")], { running: ["read-0"] })
  const rows = itemToggles(view.host)
  expect(rows).toHaveLength(5)
  expect(rows.map((row) => row.textContent)).toEqual(Array.from({ length: 5 }, (_, index) => expect.stringContaining(`file-${index}.ts`)))
  expect(rows[0].textContent).toContain("运行中…")
  expect(rows[0].getAttribute("aria-expanded")).toBe("false")
  expect(rows[0].className).not.toContain("bg-")
  expect(details(view.host)).toBeNull()
  click(rows[0])
  expect(rows[0].getAttribute("aria-expanded")).toBe("true")
  expect(details(view.host)?.textContent).toContain("/tmp/file-0.ts")
  expect(details(view.host)?.querySelector("pre")?.textContent).toBe("partial output")

  view.update([...calls(6), result("read-0", "done")], [])
  expect(itemToggles(view.host)).toHaveLength(6)
  expect(itemToggles(view.host)[0]).toBe(rows[0])
  expect(rows[0].getAttribute("aria-expanded")).toBe("true")
  expect(rows[0].textContent).not.toContain("运行中…")
  expect(rows[1].getAttribute("aria-expanded")).toBe("false")
  expect(view.host.querySelectorAll("[data-tool-call-entry-detail]")).toHaveLength(1)
  expect(details(view.host)?.querySelector("pre")?.textContent).toBe("done")
})

it("keeps approved persisted image routes behind the Process and individual call disclosures", () => {
  const messages = mapHistoryMessagesToUi("session-image", [
    { id: "image-call", role: "assistant", content: "", created_at: at,
      tool_calls: [{ id: "image", type: "function", function: { name: "view_image", arguments: '{"path":"/tmp/image.png"}' } }] },
    { id: "image-result", role: "tool", content: "image ready", tool_call_id: "image", created_at: at, content_parts: [
      { type: "image_url", image_url: { url: dataImage } },
      { type: "image_url", image_url: { url: "bamboo-attachment://session-image/asset-1" } },
    ] },
  ])
  const view = mount([...messages, call("mixed")], { process: true })
  expect(view.host.querySelector("img")).toBeNull()
  click(view.host.querySelector<HTMLButtonElement>("[data-process-toggle]")!)
  expect(view.host.querySelector("img")).toBeNull()
  click(itemToggles(view.host)[0])
  const sources = [dataImage, apiClient.resolveUrl("sessions/session-image/attachments/asset-1")]
  expect([...view.host.querySelectorAll("img")].map((image) => image.getAttribute("src"))).toEqual(sources)
  click(view.host.querySelector<HTMLButtonElement>("[aria-label='预览工具图片 1']")!)
  expect(view.onPreviewImage).toHaveBeenCalledExactlyOnceWith(dataImage)
})

it("keeps only allowed ViewImage results and rejects unrelated browser images", () => {
  const image = (id: string, url: string, type = "image/png") => ({ id, url, name: id, type, size: 0 })
  const images = [image("allowed", dataImage), image("svg", "data:image/svg+xml;base64,aGVsbG8=", "image/svg+xml"),
    image("remote", "https://example.com/track.png")]
  const safe = mount([call("image", "ViewImage"), result("image", "ready", "ViewImage", images)], { single: true })
  expect([...safe.host.querySelectorAll("img")].map((entry) => entry.getAttribute("src"))).toEqual([dataImage])
  click(safe.host.querySelector("img")!.closest("button")!)
  expect(safe.onPreviewImage).toHaveBeenCalledExactlyOnceWith(dataImage)
  expect(itemToggles(safe.host)).toHaveLength(0)

  const browser = mount([call("browser", "browser", { action: "tabs" }), result("browser", '{}', "browser", images)], { single: true })
  expect(browser.host.querySelector("img")).toBeNull()
})

it("previews the current running call without adding disclosure or leaking ordinary result bodies", () => {
  const bash = call("bash", "Bash", { command: "npm run test:run" })
  const view = mount([call("old"), bash], { preview: true, running: ["bash"] })
  const preview = view.host.querySelector("[data-tool-call-preview]")!
  expect(preview.textContent).toContain("运行命令")
  expect(preview.textContent).toContain("npm run test:run")
  expect(preview.textContent).toContain("运行中…")
  expect(view.host.querySelector("button, summary, details, [aria-expanded], pre")).toBeNull()
  view.update(read(), ["read"])
  expect(view.host.querySelector("[data-tool-call-preview]")).toBe(preview)
  expect(preview.textContent).toContain("读取文件")
  expect(preview.textContent).toContain("tmp/example.ts")
  expect(preview.textContent).not.toContain("done")
  view.update(read(), [])
  expect(preview.textContent).not.toContain("运行中…")
})

it.each([["Task", "委派任务"], ["Plan", "更新计划"], ["Edit", "编辑文件"], ["Write", "编辑文件"]])(
  "uses the readable action for %s", (name, label) => {
    expect(itemToggles(mount([call("named", name)]).host)[0].textContent).toContain(label)
  },
)

it("updates the tool labels with the locale without changing raw names", async () => {
  const view = mount([call("bash", "Bash"), call("image", "view_image"), call("patch", "apply_patch")])
  try {
    expect(itemToggles(view.host).map((entry) => entry.textContent)).toEqual(["运行命令", "查看图片", "编辑文件"])
    await changeLocale("en-US", { persist: false })
    flush()
    expect(itemToggles(view.host).map((entry) => entry.textContent)).toEqual(["Run command", "View image", "Edit file"])
    for (const toggle of itemToggles(view.host)) click(toggle)
    expect([...view.host.querySelectorAll("[data-tool-call-entry-detail]")].map((entry) => entry.textContent))
      .toEqual(["Bash", "view_image", "apply_patch"])
  } finally { await changeLocale("zh-CN", { persist: false }); flush() }
})

it("shows a real compact file diff with its basename and full path instead of raw result JSON", () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} })
  const path = "/tmp/nested/example.ts"
  const view = mount([call("edit", "apply_patch"), result("edit", JSON.stringify({ operation: "edit", file_path: path,
    diff: { unified: "--- a/example.ts\n+++ b/example.ts\n@@ -1 +1 @@\n-before\n+after\n" } }), "apply_patch")], { single: true })
  expect(details(view.host)?.querySelector("span[title]")?.getAttribute("title")).toBe(path)
  expect(details(view.host)?.querySelector("span[title]")?.textContent).toBe("example.ts")
  expect(details(view.host)?.textContent).toContain("before")
  expect(details(view.host)?.textContent).toContain("after")
  expect(details(view.host)?.querySelector("pre")).toBeNull()
  expect(view.host.textContent).not.toContain('"unified"')
})

it.each([false, true])("updates the background shell badge without exposing environment fields (preview=%s)", (preview) => {
  const bashId = `test-background-${preview}`
  const previous = appStore.getState().backgroundBash
  cleanup.push(() => appStore.setState({ backgroundBash: previous }))
  const view = mount([call("bash", "Bash"), result("bash", JSON.stringify({ bash_id: bashId, command: "npm run test:run",
    status: "running", environment: { private: "hidden environment" } }), "Bash")], { preview, single: true })
  expect(view.host.textContent).toContain("后台运行中…")
  expect(view.host.textContent).not.toContain("hidden environment")
  appStore.getState().setBashCompleted(bashId, "completed", 0)
  flush()
  expect(view.host.textContent).toContain("已完成")
  expect(view.host.textContent).toContain("exit 0")
  expect(view.host.textContent).not.toContain("后台运行中…")
})

it("confirms live delivery only after a canonical receipt and preserves long inspected values", () => {
  const message = "多行消息\n".repeat(120) + "消息完整末尾"
  const note = "secondary".repeat(40) + "PARAM_END"
  const output = "result".repeat(400) + "RESULT_END"
  const entry = call("q", "SubAgent", { action: "send_message", interrupt_running: true, message, note })
  const receipt = (status: string) => result("q", JSON.stringify({ status }), "SubAgent")
  const preview = mount([entry], { preview: true, running: ["q"] })
  expect(preview.host.textContent).toContain("插话")
  expect(preview.host.textContent).toContain("等待确认")
  expect(preview.host.textContent).not.toContain("已送达")
  preview.update([entry, receipt("message_queued")])
  expect(preview.host.textContent).toContain("队列中")
  expect(preview.host.textContent).not.toContain("已送达")
  preview.update([entry, receipt("message_delivered_live")])
  expect(preview.host.textContent).toContain("已送达，已通知当前会话")

  const inspect = mount([entry, receipt("message_queued")])
  const toggle = itemToggles(inspect.host)[0]
  expect(toggle.textContent).toContain("插话")
  expect(toggle.textContent).toContain("队列中")
  click(toggle)
  expect(toggle.textContent).not.toContain("已送达")
  inspect.update([entry, result("q", output, "SubAgent")])
  expect(details(inspect.host)?.textContent).toContain(message)
  expect(details(inspect.host)?.textContent).toContain(note)
  expect(details(inspect.host)?.querySelector("pre")?.textContent).toBe(output)
  expect(details(inspect.host)?.querySelector('[class*="line-clamp"]')).toBeNull()
})
