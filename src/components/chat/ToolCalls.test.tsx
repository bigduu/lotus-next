import { changeLocale } from "@shared/i18n"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest"

import type { Message } from "@shared/types/chatMessages"
import { mapHistoryMessagesToUi } from "@shared/store/appStore/slices/chatSessionSlice/messageMapping"
import { apiClient } from "@services/api"
import { useAppStore } from "@shared/store/appStore"
import { ToolCalls } from "./ToolCalls"
import { ProcessActivity } from "./ProcessActivity"

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

afterEach(() => {
  for (const root of mountedRoots.splice(0)) act(() => root.unmount())
  document.body.replaceChildren()
})

function toolMessages(withResult = false): Message[] {
  const messages = [
    {
      id: "call-message",
      role: "assistant",
      type: "tool_call",
      toolCalls: [
        {
          toolCallId: "call-1",
          toolName: "Read",
          parameters: { file_path: "/tmp/example.ts" },
        },
      ],
      createdAt: "2026-09-20T00:00:00Z",
    },
  ] as unknown as Message[]

  if (withResult) {
    messages.push({
      id: "result-message",
      role: "tool",
      type: "tool_result",
      toolCallId: "call-1",
      result: { result: "done" },
      isError: false,
      createdAt: "2026-09-20T00:00:01Z",
    } as unknown as Message)
  }
  return messages
}

function mixedToolMessages(): Message[] {
  return [
    {
      id: "mixed-tools",
      role: "assistant",
      type: "tool_call",
      toolCalls: [
        {
          toolCallId: "bash-1",
          toolName: "Bash",
          parameters: { command: "npm run test:run" },
        },
        {
          toolCallId: "image-1",
          toolName: "view_image",
          parameters: { path: "/tmp/reference.png" },
        },
        {
          toolCallId: "edit-1",
          toolName: "apply_patch",
          parameters: {},
        },
      ],
      createdAt: "2026-09-20T00:00:00Z",
    },
  ] as unknown as Message[]
}

function singleToolMessage(toolName: string): Message[] {
  return [
    {
      id: `${toolName}-message`,
      role: "assistant",
      type: "tool_call",
      toolCalls: [{ toolCallId: `${toolName}-call`, toolName, parameters: {} }],
      createdAt: "2026-09-20T00:00:00Z",
    },
  ] as unknown as Message[]
}

const privateText = "private typed text 149"
const privateKey = "private-key-149"
const privateResource = "browser:17:type:private-fingerprint-149"
const privateEvalUrl = "https://example.test/account?token=private-query-151"
const privateEvalResult = "private-page-value-151"
const approvalResult = JSON.stringify({
  status: "awaiting_permission_approval",
  question: "Approve focused browser input?",
  permission_request: {
    resource: privateResource,
    suggested_matchers: [{ value: privateKey }],
  },
})

function browserMessages(parameters: unknown, result = approvalResult, isError = false, toolName = "browser"): Message[] {
  return [
    {
      id: "browser-call-message",
      role: "assistant",
      type: "tool_call",
      toolCalls: [{ toolCallId: "browser-call", toolName, parameters }],
      createdAt: "2026-09-20T00:00:00Z",
    },
    {
      id: "browser-result-message",
      role: "tool",
      type: "tool_result",
      toolCallId: "browser-call",
      result: { result },
      isError,
      createdAt: "2026-09-20T00:00:01Z",
    },
  ] as unknown as Message[]
}

function renderOpenTools(messages: Message[]) {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  mountedRoots.push(root)
  act(() => root.render(<ToolCalls items={messages} />))
  const toggle = host.querySelector<HTMLButtonElement>("[data-tool-call-toggle]")
  act(() => toggle?.click())
  for (const entryToggle of host.querySelectorAll<HTMLElement>("[data-tool-call-entry-toggle]")) {
    act(() => entryToggle.click())
  }
  return host
}

it("shows persisted ViewImage image data only after both disclosure levels open", () => {
  const dataUrl = "data:image/png;base64,aGVsbG8="
  const messages = mapHistoryMessagesToUi("session-image", [
    {
      id: "assistant-image-call",
      role: "assistant",
      content: "",
      tool_calls: [{ id: "image-call", type: "function", function: { name: "view_image", arguments: '{"path":"/tmp/image.png"}' } }],
      created_at: "2026-09-24T00:00:00Z",
    },
    {
      id: "image-result",
      role: "tool",
      tool_call_id: "image-call",
      content: "image ready",
      content_parts: [
        { type: "image_url", image_url: { url: dataUrl } },
        { type: "image_url", image_url: { url: "bamboo-attachment://session-image/asset-1" } },
      ],
      created_at: "2026-09-24T00:00:01Z",
    },
  ])
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  mountedRoots.push(root)
  const preview = vi.fn()
  act(() => root.render(<ToolCalls items={messages} onPreviewImage={preview} />))
  expect(host.querySelector("img")).toBeNull()
  act(() => host.querySelector<HTMLButtonElement>("[data-tool-call-toggle]")?.click())
  expect(host.querySelector("img")).toBeNull()
  act(() => host.querySelector<HTMLElement>("[data-tool-call-entry-toggle]")?.click())
  expect(host.querySelector("img")?.getAttribute("src")).toBe(dataUrl)
  expect(host.querySelectorAll("img")[1]?.getAttribute("src")).toBe(apiClient.resolveUrl("sessions/session-image/attachments/asset-1"))
  act(() => host.querySelector<HTMLButtonElement>("[aria-label='预览工具图片 1']")?.click())
  expect(preview).toHaveBeenCalledWith(dataUrl)
})

it("shows live ViewImage images but rejects unsafe result schemes and unrelated browser images", () => {
  const dataUrl = "data:image/png;base64,aGVsbG8="
  const messages = [
    ...singleToolMessage("ViewImage"),
    {
      id: "live-image-result", role: "tool", type: "tool_result", toolCallId: "ViewImage-call",
      result: { result: "ready" }, isError: false,
      images: [
        { id: "valid", url: dataUrl, name: "image", type: "image/png", size: 0 },
        { id: "unsafe", url: "data:image/svg+xml;base64,aGVsbG8=", name: "unsafe", type: "image/svg+xml", size: 0 },
        { id: "remote", url: "https://example.com/track.png", name: "remote", type: "image/png", size: 0 },
      ],
      createdAt: "",
    } as unknown as Message,
  ]
  const host = renderOpenTools(messages)
  expect(host.querySelectorAll("img")).toHaveLength(1)
  expect(host.querySelector("img")?.getAttribute("src")).toBe(dataUrl)

  const browser = renderOpenTools([
    ...singleToolMessage("browser"),
    { id: "browser-result", role: "tool", type: "tool_result", toolCallId: "browser-call",
      result: { result: "done" }, images: messages[1] && (messages[1] as { images?: unknown[] }).images,
      createdAt: "" } as unknown as Message,
  ])
  expect(browser.querySelector("img")).toBeNull()
})

it("starts active tool calls collapsed and preserves a manual expansion after completion", () => {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  mountedRoots.push(root)

  act(() => root.render(<ToolCalls items={toolMessages()} active />))

  const toggle = host.querySelector<HTMLButtonElement>("button[aria-expanded]")
  expect(toggle?.getAttribute("aria-expanded")).toBe("false")
  expect(toggle?.textContent).toContain("读取文件")
  expect(toggle?.textContent).toContain("example.ts")
  expect(toggle?.className).not.toContain("bg-")
  expect(host.textContent).not.toContain("/tmp/example.ts")

  act(() => toggle?.click())
  expect(toggle?.getAttribute("aria-expanded")).toBe("true")
  expect(host.querySelector("[data-tool-call-entry-detail]")).toBeNull()
  const entryToggle = host.querySelector<HTMLElement>("[data-tool-call-entry-toggle]")
  expect(entryToggle?.getAttribute("aria-expanded")).toBe("false")
  act(() => entryToggle?.click())
  expect(entryToggle?.getAttribute("aria-expanded")).toBe("true")
  expect(host.textContent).toContain("/tmp/example.ts")
  expect(host.querySelector<HTMLElement>("[data-tool-call-panel]")?.className).not.toContain("bg-")
  expect(host.querySelector<HTMLElement>("[data-tool-call-entry]")?.className).not.toContain("bg-")

  act(() => root.render(<ToolCalls items={toolMessages(true)} active={false} />))
  expect(toggle?.getAttribute("aria-expanded")).toBe("true")
  expect(host.textContent).toContain("done")
})

it("lists every call as a compact row and keeps an expanded row open as calls arrive", () => {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  mountedRoots.push(root)
  const messages = (count: number) => [{
    id: "tool-round",
    role: "assistant",
    type: "tool_call",
    toolCalls: Array.from({ length: count }, (_, index) => ({
      toolCallId: `read-${index}`,
      toolName: "Read",
      parameters: { file_path: `/tmp/file-${index}.ts` },
    })),
    createdAt: "2026-09-20T00:00:00Z",
  }] as unknown as Message[]

  act(() => root.render(<ToolCalls items={messages(5)} active />))
  expect(host.querySelector("[data-tool-call-panel]")).toBeNull()
  act(() => host.querySelector<HTMLButtonElement>("[data-tool-call-toggle]")?.click())

  const rows = host.querySelectorAll<HTMLElement>("[data-tool-call-entry-toggle]")
  expect(rows).toHaveLength(5)
  expect(Array.from(rows, (row) => row.textContent)).toEqual(
    Array.from({ length: 5 }, (_, index) => expect.stringContaining(`file-${index}.ts`)),
  )
  expect(host.textContent).not.toContain("展开更早")
  expect(host.querySelectorAll("[data-tool-call-entry-detail]")).toHaveLength(0)

  act(() => rows[0].click())
  expect(host.querySelectorAll("[data-tool-call-entry-detail]")).toHaveLength(1)
  expect(host.textContent).toContain("/tmp/file-0.ts")

  act(() => root.render(<ToolCalls items={messages(6)} active />))
  expect(host.querySelectorAll("[data-tool-call-entry-toggle]")).toHaveLength(6)
  expect(host.querySelector<HTMLElement>("[data-tool-call-entry-toggle]")?.getAttribute("aria-expanded")).toBe("true")
  expect(host.querySelectorAll("[data-tool-call-entry-detail]")).toHaveLength(1)
})

it("keeps a call marked running while its partial output is visible", () => {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  mountedRoots.push(root)
  const messages = toolMessages(true)

  act(() => root.render(
    <ToolCalls items={messages} active runningCallIds={new Set(["call-1"])} />,
  ))
  act(() => host.querySelector<HTMLButtonElement>("[data-tool-call-toggle]")?.click())
  expect(host.querySelector("[data-tool-call-entry-toggle]")?.textContent).toContain("运行中…")

  act(() => root.render(
    <ToolCalls items={messages} active={false} runningCallIds={new Set()} />,
  ))
  expect(host.querySelector("[data-tool-call-entry-toggle]")?.textContent).not.toContain("运行中…")
})

it("supports controlled expansion for virtualized history rows", () => {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  mountedRoots.push(root)
  const onOpenChange = vi.fn()

  act(() => root.render(
    <ToolCalls items={toolMessages(true)} open={false} onOpenChange={onOpenChange} />,
  ))
  const toggle = host.querySelector<HTMLButtonElement>("[data-tool-call-toggle]")
  expect(toggle?.getAttribute("aria-expanded")).toBe("false")
  expect(host.querySelector("[data-tool-call-panel]")).toBeNull()

  act(() => toggle?.click())
  expect(onOpenChange).toHaveBeenCalledWith(true)
  expect(toggle?.getAttribute("aria-expanded")).toBe("false")

  act(() => root.render(
    <ToolCalls items={toolMessages(true)} open onOpenChange={onOpenChange} />,
  ))
  expect(toggle?.getAttribute("aria-expanded")).toBe("true")
  expect(host.querySelector("[data-tool-call-panel]")).not.toBeNull()
})

it("summarizes mixed tools as readable actions without exposing noisy arguments", () => {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  mountedRoots.push(root)

  act(() => root.render(<ToolCalls items={mixedToolMessages()} />))

  const toggle = host.querySelector<HTMLButtonElement>("[data-tool-call-toggle]")
  expect(toggle?.textContent).toContain("运行命令、查看图片、编辑文件")
  expect(toggle?.textContent).not.toContain("npm run test:run")
  expect(toggle?.textContent).not.toContain("/tmp/reference.png")
  expect(toggle?.title).toBe("Bash、view_image、apply_patch")
})

it.each([
  ["Task", "委派任务"],
  ["Plan", "更新计划"],
  ["Edit", "编辑文件"],
  ["Write", "编辑文件"],
])("gives the common %s tool a readable action name", (toolName, expectedLabel) => {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  mountedRoots.push(root)

  act(() => root.render(<ToolCalls items={singleToolMessage(toolName)} />))

  expect(host.querySelector("[data-tool-call-toggle]")?.textContent).toContain(expectedLabel)
})

it("shows a Process's only tool result after opening only the Process disclosure", () => {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host); mountedRoots.push(root)
  act(() => root.render(<ProcessActivity>
    <ToolCalls items={toolMessages(true)} presentation="process" singleExpanded />
  </ProcessActivity>))
  const processToggle = host.querySelector<HTMLButtonElement>("[data-process-toggle]")!
  const content = host.querySelector<HTMLElement>("[data-process-content]")!
  expect(content.getAttribute("aria-hidden")).toBe("true")
  expect(content.hasAttribute("inert")).toBe(true)
  expect(content.hasAttribute("hidden")).toBe(false)
  expect(host.querySelector("[data-tool-call-toggle]")).toBeNull()
  expect(host.querySelector("[data-tool-call-entry-toggle]")).toBeNull()
  expect(host.querySelector("details")).toBeNull()
  act(() => processToggle.click())
  expect(host.querySelector("[data-process-content]")).toBe(content)
  expect(content.getAttribute("aria-hidden")).toBe("false")
  expect(content.hasAttribute("inert")).toBe(false)
  expect(host.querySelector("[data-tool-call-entry-heading]")?.textContent).toContain("读取文件")
  expect(host.querySelector("[data-tool-call-entry-detail]")?.textContent).toContain("/tmp/example.ts")
  expect(host.querySelector("[data-tool-call-entry-detail] pre")?.textContent).toBe("done")
})

it("keeps only individual disclosures for multiple tools inside a Process", () => {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host); mountedRoots.push(root)
  act(() => root.render(<ToolCalls items={mixedToolMessages()} presentation="process" />))
  expect(host.querySelector("[data-tool-call-toggle]")).toBeNull()
  const rows = host.querySelectorAll<HTMLElement>("[data-tool-call-entry-toggle]")
  expect(rows).toHaveLength(3)
  expect(host.querySelector("[data-tool-call-entry-detail]")).toBeNull()
  act(() => rows[0].click())
  expect(rows[0].getAttribute("aria-expanded")).toBe("true")
  expect(rows[1].getAttribute("aria-expanded")).toBe("false")
  expect(host.querySelectorAll("[data-tool-call-entry-detail]")).toHaveLength(1)
  expect(host.querySelector("[data-tool-call-entry-detail]")?.textContent).toContain("npm run test:run")
})

it("keeps a directly expanded call's result visible when its Process gains another tool", () => {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host); mountedRoots.push(root)
  act(() => root.render(<ToolCalls items={toolMessages(true)} presentation="process" singleExpanded />))
  expect(host.querySelector("[data-tool-call-entry-toggle]")).toBeNull()
  act(() => root.render(<ToolCalls items={[...toolMessages(true), ...singleToolMessage("Bash")]} presentation="process" />))
  const rows = host.querySelectorAll<HTMLElement>("[data-tool-call-entry-toggle]")
  expect(rows).toHaveLength(2)
  expect(rows[0].getAttribute("aria-expanded")).toBe("true")
  expect(rows[1].getAttribute("aria-expanded")).toBe("false")
  expect(host.querySelector("[data-tool-call-entry-detail] pre")?.textContent).toBe("done")
})

it("renders the latest running preview as one readable line without disclosure or raw results", () => {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host); mountedRoots.push(root)
  act(() => root.render(<ToolCalls items={mixedToolMessages()} presentation="preview" active runningCallIds={new Set(["bash-1"])} />))
  const preview = host.querySelector("[data-tool-call-preview]")!
  expect(preview.textContent).toContain("运行命令")
  expect(preview.textContent).toContain("npm run test:run")
  expect(preview.textContent).toContain("运行中…")
  expect(host.querySelector("button, summary, details, [aria-expanded]")).toBeNull()
  expect(host.querySelectorAll("[data-tool-call-preview]")).toHaveLength(1)
  act(() => root.render(<ToolCalls items={toolMessages(true)} presentation="preview" active runningCallIds={new Set(["call-1"])} />))
  expect(preview.textContent).toContain("读取文件")
  expect(preview.textContent).toContain("tmp/example.ts")
  expect(preview.textContent).toContain("运行中…")
  expect(preview.textContent).not.toContain("done")
  act(() => root.render(<ToolCalls items={toolMessages(true)} presentation="preview" runningCallIds={new Set()} />))
  expect(preview.textContent).not.toContain("运行中…")
})

it.each(["process", "preview"] as const)("keeps private browser inputs and approval receipts hidden in %s presentation", (presentation) => {
  const messages = browserMessages({ action: "type", text: privateText, unexpected: { text: privateText } })
  const original = JSON.stringify(messages)
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host); mountedRoots.push(root)
  act(() => root.render(<ToolCalls items={messages} presentation={presentation} singleExpanded />))
  expect(host.textContent).toContain("等待用户批准")
  for (const value of [privateText, privateKey, privateResource, "permission_request"]) expect(host.textContent).not.toContain(value)
  expect(host.querySelector("button, summary, details, [aria-expanded]")).toBeNull()
  expect(JSON.stringify(messages)).toBe(original)
})

it("does not copy ordinary browser result bodies into a preview", () => {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host); mountedRoots.push(root)
  const messages = browserMessages({ action: "tabs" }, JSON.stringify({ value: privateEvalResult, url: privateEvalUrl }))
  act(() => root.render(<ToolCalls items={messages} presentation="preview" />))
  expect(host.textContent).not.toContain(privateEvalResult)
  expect(host.textContent).not.toContain(privateEvalUrl)
  expect(host.querySelector("pre")).toBeNull()
})

it("preserves safe ViewImage previews in a directly expanded Process call", () => {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host); mountedRoots.push(root)
  const onPreviewImage = vi.fn()
  const messages = [
    ...singleToolMessage("view_image"),
    { id: "image-result", role: "tool", type: "tool_result", toolCallId: "view_image-call", result: { result: "image ready" },
      images: [{ id: "image", base64: "aGVsbG8=", type: "image/png", name: "image.png", size: 5 }], createdAt: "2026-09-20T00:00:01Z" },
  ] as unknown as Message[]
  act(() => root.render(<ToolCalls items={messages} presentation="process" singleExpanded onPreviewImage={onPreviewImage} />))
  const image = host.querySelector("img")!
  expect(image.getAttribute("src")).toBe("data:image/png;base64,aGVsbG8=")
  act(() => image.closest("button")?.click())
  expect(onPreviewImage).toHaveBeenCalledWith("data:image/png;base64,aGVsbG8=")
  expect(host.querySelector("[data-tool-call-entry-toggle]")).toBeNull()
})

it("preserves file diffs instead of exposing their result JSON in a Process call", () => {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host); mountedRoots.push(root)
  const messages = [
    ...singleToolMessage("apply_patch"),
    { id: "diff-result", role: "tool", type: "tool_result", toolCallId: "apply_patch-call", result: { result: JSON.stringify({
      operation: "edit", file_path: "/tmp/example.ts", diff: { unified: "--- a/example.ts\n+++ b/example.ts\n@@ -1 +1 @@\n-before\n+after\n" },
    }) }, createdAt: "2026-09-20T00:00:01Z" },
  ] as unknown as Message[]
  act(() => root.render(<ToolCalls items={messages} presentation="process" singleExpanded />))
  expect(host.querySelector("[data-tool-call-entry-detail]")?.textContent).toContain("before")
  expect(host.querySelector("[data-tool-call-entry-detail]")?.textContent).toContain("after")
  expect(host.querySelector("[data-tool-call-entry-detail] pre")).toBeNull()
  expect(host.textContent).not.toContain('"unified"')
})

it.each(["process", "preview"] as const)("keeps the background shell badge reactive in %s presentation", (presentation) => {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host); mountedRoots.push(root)
  const bashId = `tool-presentation-background-${presentation}`
  const messages = [
    ...singleToolMessage("Bash"),
    { id: "background-result", role: "tool", type: "tool_result", toolCallId: "Bash-call", result: { result: JSON.stringify({
      bash_id: bashId, command: "npm run test:run", status: "running", environment: { private: "hidden environment" },
    }) }, createdAt: "2026-09-20T00:00:01Z" },
  ] as unknown as Message[]
  act(() => root.render(<ToolCalls items={messages} presentation={presentation} singleExpanded />))
  expect(host.textContent).toContain("后台运行中…")
  expect(host.textContent).not.toContain("hidden environment")
  act(() => useAppStore.getState().setBashCompleted(bashId, "completed", 0))
  expect(host.textContent).toContain("已完成")
  expect(host.textContent).toContain("exit 0")
  expect(host.textContent).not.toContain("后台运行中…")
})

it("uses English list punctuation after changing language without translating raw tool names", async () => {
  const host = document.createElement("div"); document.body.append(host)
  const root = createRoot(host); mountedRoots.push(root)
  await act(async () => root.render(<ToolCalls items={mixedToolMessages()} />))
  await act(async () => { await changeLocale("en-US") })
  const toggle = host.querySelector<HTMLButtonElement>("[data-tool-call-toggle]")!
  expect(toggle.textContent).not.toContain("、")
  expect(toggle.textContent).toContain("Run command")
  expect(toggle.title).toBe("Bash, view_image, apply_patch")
})

it("shows queue receipts as message actions in collapsed and expanded tool cards", () => {
  const messages = mapHistoryMessagesToUi("queue", [
    { id: "call", role: "assistant", content: "", created_at: "now", tool_calls: [
      { id: "q", type: "function", function: { name: "SubAgent", arguments: JSON.stringify({ action: "send_message", child_session_id: "child", message: "follow up", interrupt_running: true }) } },
    ] },
    { id: "result", role: "tool", content: '{"status":"message_queued"}', tool_call_id: "q", created_at: "now" },
  ])
  const host = renderOpenTools(messages)
  expect(host.querySelector("[data-tool-call-toggle]")?.textContent).toContain("插话")
  expect(host.querySelector("[data-tool-call-toggle]")?.textContent).toContain("队列中")
  expect(host.querySelector("[data-tool-call-entry-heading], [data-tool-call-entry-toggle]")?.textContent).not.toContain("已送达")
})
it("preserves complete long text, secondary parameters and results after disclosure", () => {
  const message = "多行消息\n".repeat(120) + "消息完整末尾"
  const note = "secondary".repeat(40) + "PARAM_END"
  const output = "result".repeat(400) + "RESULT_END"
  const messages = mapHistoryMessagesToUi("long", [
    { id: "call", role: "assistant", content: "", created_at: "now", tool_calls: [
      { id: "q", type: "function", function: { name: "SubAgent", arguments: JSON.stringify({ action: "send_message", message, note }) } },
    ] },
    { id: "result", role: "tool", content: output, tool_call_id: "q", created_at: "now" },
  ])
  const host = renderOpenTools(messages)
  const detail = host.querySelector("[data-tool-call-entry-detail]")!
  expect(detail.textContent).toContain(message)
  expect(detail.textContent).toContain(note)
  expect(detail.querySelector("pre")?.textContent).toBe(output)
  expect(detail.querySelector('[class*="line-clamp"]')).toBeNull()
})

it("updates a live message preview from pending to queued to explicitly delivered", () => {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host); mountedRoots.push(root)
  const call = { id: "call", role: "assistant" as const, content: "", created_at: "now", tool_calls: [
    { id: "q", type: "function", function: { name: "SubAgent", arguments: JSON.stringify({ action: "send_message", interrupt_running: true }) } },
  ] }
  const renderStatus = (status?: string) => act(() => root.render(<ToolCalls presentation="preview" active items={mapHistoryMessagesToUi("live", [call, ...(status ? [
    { id: "result", role: "tool" as const, content: JSON.stringify({ status }), tool_call_id: "q", created_at: "now" },
  ] : [])])} />))
  renderStatus()
  expect(host.textContent).toContain("插话")
  expect(host.textContent).toContain("等待确认")
  expect(host.textContent).not.toContain("已送达")
  renderStatus("message_queued")
  expect(host.textContent).toContain("队列中")
  expect(host.textContent).not.toContain("已送达")
  renderStatus("message_delivered_live")
  expect(host.textContent).toContain("已送达，已通知当前会话")
})
