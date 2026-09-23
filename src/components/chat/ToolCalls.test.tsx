import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest"

import type { Message } from "@shared/types/chatMessages"
import { mapHistoryMessagesToUi } from "@shared/store/appStore/slices/chatSessionSlice/messageMapping"
import { ToolCalls } from "./ToolCalls"

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
const approvalResult = JSON.stringify({
  status: "awaiting_permission_approval",
  question: "Approve focused browser input?",
  permission_request: {
    resource: privateResource,
    suggested_matchers: [{ value: privateKey }],
  },
})

function browserMessages(parameters: unknown, result = approvalResult): Message[] {
  return [
    {
      id: "browser-call-message",
      role: "assistant",
      type: "tool_call",
      toolCalls: [{ toolCallId: "browser-call", toolName: "browser", parameters }],
      createdAt: "2026-09-20T00:00:00Z",
    },
    {
      id: "browser-result-message",
      role: "tool",
      type: "tool_result",
      toolCallId: "browser-call",
      result: { result },
      isError: false,
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
  const resultToggle = host.querySelector<HTMLElement>("[data-tool-call-entry] details summary")
  act(() => resultToggle?.click())
  return host
}

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
  expect(host.textContent).toContain("/tmp/example.ts")
  expect(host.querySelector<HTMLElement>("[data-tool-call-panel]")?.className).not.toContain("bg-")
  expect(host.querySelector<HTMLElement>("[data-tool-call-entry]")?.className).not.toContain("bg-")

  act(() => root.render(<ToolCalls items={toolMessages(true)} active={false} />))
  expect(toggle?.getAttribute("aria-expanded")).toBe("true")
  expect(host.textContent).toContain("done")
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

it.each([
  ["type", { action: "type", text: privateText, unexpected: { text: privateText } }],
  ["key", { action: "key", key: privateKey }],
  ["untargeted press", { action: "press", key: privateKey }],
  ["null selector press", { action: "press", selector: null, key: privateKey }],
  ["blank selector press", { action: "press", selector: " ", key: privateKey }],
  ["invalid semantic press", { action: "press", target: {}, key: privateKey }],
])("hides %s input and approval fingerprints in live ToolCalls", (_name, parameters) => {
  const messages = browserMessages(parameters)
  const unchanged = JSON.stringify(messages)
  const host = renderOpenTools(messages)

  expect(host.textContent).toContain("等待用户批准")
  expect(host.textContent).not.toContain(privateText)
  expect(host.textContent).not.toContain(privateKey)
  expect(host.textContent).not.toContain(privateResource)
  expect(host.querySelector("[data-tool-call-entry] pre")?.textContent).toBe("等待用户批准")
  expect(JSON.stringify(messages)).toBe(unchanged)
})

it("hides original focused arguments and approval receipt after history mapping", () => {
  const rawArguments = JSON.stringify({ action: "type", text: privateText, expected_epoch: 17 })
  const messages = mapHistoryMessagesToUi("session-149", [
    {
      id: "assistant-call",
      role: "assistant",
      content: "",
      tool_calls: [{ id: "browser-call", type: "function", function: { name: "browser", arguments: rawArguments } }],
      created_at: "2026-09-20T00:00:00Z",
    },
    {
      id: "tool-result",
      role: "tool",
      tool_call_id: "browser-call",
      content: approvalResult,
      created_at: "2026-09-20T00:00:01Z",
    },
  ])
  const host = renderOpenTools(messages)

  expect(JSON.stringify(messages)).toContain(privateText)
  expect(JSON.stringify(messages)).toContain(privateResource)
  expect(host.textContent).toContain("等待用户批准")
  expect(host.textContent).not.toContain(privateText)
  expect(host.textContent).not.toContain(privateResource)
})

it("shows a safe status for a parked approval on another tool", () => {
  const messages = toolMessages()
  messages.push({
    id: "approval-result",
    role: "tool",
    type: "tool_result",
    toolCallId: "call-1",
    result: { result: approvalResult },
    createdAt: "2026-09-20T00:00:01Z",
  } as unknown as Message)
  const host = renderOpenTools(messages)

  expect(host.querySelector("[data-tool-call-entry] pre")?.textContent).toBe("等待用户批准")
  expect(host.textContent).not.toContain(privateResource)
  expect(host.textContent).not.toContain(privateKey)
})

it("keeps selector-bound press and ordinary tool details visible", () => {
  const css = renderOpenTools(browserMessages(
    { action: "press", selector: "#save", key: privateKey },
    JSON.stringify({ ok: true, action: "press" }),
  ))
  expect(css.textContent).toContain("#save")
  expect(css.textContent).toContain(privateKey)
  expect(css.textContent).toContain("ok")

  const semantic = renderOpenTools(browserMessages(
    { action: "press", target: { kind: "role", role: "button", name: "Save" }, key: privateKey },
    JSON.stringify({ ok: true }),
  ))
  expect(semantic.textContent).toContain(privateKey)

  const label = renderOpenTools(browserMessages(
    { action: "press", target: { kind: "label", value: "Email" }, key: privateKey },
    JSON.stringify({ ok: true }),
  ))
  expect(label.textContent).toContain(privateKey)
  expect(label.textContent).toContain("Email")

  const ordinary = renderOpenTools(toolMessages(true))
  expect(ordinary.textContent).toContain("/tmp/example.ts")
  expect(ordinary.textContent).toContain("done")
})

it("omits malformed and oversized browser previews without exposing raw fallbacks", () => {
  const malformed = renderOpenTools(browserMessages(
    { raw: `{"action":"type","text":"${privateText}"` },
    `{"status":"awaiting_permission_approval","permission_request":{"resource":"${privateResource}"`,
  ))
  expect(malformed.textContent).not.toContain(privateText)
  expect(malformed.textContent).not.toContain(privateResource)
  expect(malformed.querySelector("[data-tool-call-entry] pre")).toBeNull()

  const oversized = renderOpenTools(browserMessages(
    { action: "type", text: privateText.repeat(1000) },
    approvalResult + privateResource.repeat(1000),
  ))
  expect(oversized.textContent).not.toContain(privateText)
  expect(oversized.textContent).not.toContain(privateResource)
  expect(oversized.querySelector("[data-tool-call-entry] pre")).toBeNull()
})
