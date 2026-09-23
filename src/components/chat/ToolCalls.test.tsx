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
const privateEvalCode = "document.querySelector('#token').textContent"
const privateEvalUrl = "https://example.test/account?token=private-query-151"
const privateEvalResult = "private-page-value-151"
const privateEvalResource = "browser_eval:17:private-fingerprint-151"
const privateSelectValue = "private-option-value-153"
const privateSelectSelector = "select[data-account='private-selector-153']"
const privateSelectResource = "browser:17:select_option:private-fingerprint-153"
const privateFileBytes = "cHJpdmF0ZS1maWxlLWJ5dGVzLTE1NQ=="
const privateFileName = "private-file-155.txt"
const privateFileMimeType = "application/x-private-155"
const privateFileSelector = "input[data-account='private-selector-155']"
const privateFileResource = "browser:17:set_file_input:private-fingerprint-155"
const largeFileBytes = "QUJD".repeat(5_000)
const fileInputParameters = {
  action: "set_file_input",
  selector: privateFileSelector,
  filename: privateFileName,
  mime_type: privateFileMimeType,
  data_base64: privateFileBytes,
  expected_epoch: 17,
}
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

function browserEvalMessages(
  parameters: unknown,
  result: string,
  isError = false,
  toolName = "browser_eval",
): Message[] {
  return [
    {
      id: "browser-eval-call-message",
      role: "assistant",
      type: "tool_call",
      toolCalls: [{ toolCallId: "browser-eval-call", toolName, parameters }],
      createdAt: "2026-09-20T00:00:00Z",
    },
    {
      id: "browser-eval-result-message",
      role: "tool",
      type: "tool_result",
      toolCallId: "browser-eval-call",
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

it.each(["browser", "default::browser"])("hides %s select_option input and result in live ToolCalls", (toolName) => {
  const messages = browserMessages(
    { action: "select_option", selector: privateSelectSelector, values: [privateSelectValue], expected_epoch: 17 },
    JSON.stringify({ ok: true, action: "select_option", selected_values: [privateSelectValue], selector: privateSelectSelector }),
    false,
    toolName,
  )
  const unchanged = JSON.stringify(messages)
  const host = renderOpenTools(messages)

  expect(host.querySelector("[data-tool-call-toggle]")?.textContent).toContain("选择网页选项")
  expect(host.textContent).not.toContain("select_option")
  expect(host.querySelector("[data-tool-call-entry] pre")?.textContent).toBe("网页选项已选择")
  for (const value of [privateSelectValue, privateSelectSelector, "selected_values"]) {
    expect(host.textContent).not.toContain(value)
  }
  expect(JSON.stringify(messages)).toBe(unchanged)
})

it("hides selected values and approval fingerprints after history mapping", () => {
  const rawArguments = JSON.stringify({
    action: "select_option", selector: privateSelectSelector, values: [privateSelectValue], expected_epoch: 17,
  })
  const approval = JSON.stringify({
    status: "awaiting_permission_approval",
    permission_request: { resource: privateSelectResource, suggested_matchers: [{ value: privateSelectValue }] },
  })
  const selected = JSON.stringify({ selected_values: [privateSelectValue], page_title: privateSelectValue })
  const messages = mapHistoryMessagesToUi("session-153", [
    {
      id: "assistant-call",
      role: "assistant",
      content: "",
      tool_calls: [
        { id: "select-result", type: "function", function: { name: "browser", arguments: rawArguments } },
        { id: "select-approval", type: "function", function: { name: "default::browser", arguments: rawArguments } },
      ],
      created_at: "2026-09-24T00:00:00Z",
    },
    { id: "tool-result", role: "tool", tool_call_id: "select-result", content: selected, created_at: "2026-09-24T00:00:01Z" },
    { id: "tool-approval", role: "tool", tool_call_id: "select-approval", content: approval, created_at: "2026-09-24T00:00:02Z" },
  ])
  const host = renderOpenTools(messages)

  expect(JSON.stringify(messages)).toContain(privateSelectValue)
  expect(JSON.stringify(messages)).toContain(privateSelectResource)
  expect(host.querySelectorAll("[data-tool-call-entry]")).toHaveLength(2)
  expect(Array.from(host.querySelectorAll("[data-tool-call-entry] pre"), (node) => node.textContent))
    .toEqual(["网页选项已选择", "等待用户批准"])
  for (const value of [privateSelectValue, privateSelectSelector, privateSelectResource, "selected_values"]) {
    expect(host.textContent).not.toContain(value)
  }
})

it("keeps fixed selection status for bounded values that exceed the JSON preview limit", () => {
  const escapedValue = "\u0001".repeat(512)
  const values = ["awaiting_permission_approval", ...Array.from({ length: 15 }, () => escapedValue)]
  const parameters = { action: "select_option", selector: privateSelectSelector, values, expected_epoch: 17 }
  const result = JSON.stringify({ selected_values: values, selector: privateSelectSelector })
  expect(JSON.stringify(parameters).length).toBeGreaterThan(16 * 1024)
  expect(result.length).toBeGreaterThan(16 * 1024)

  const liveMessages = browserMessages(parameters, result)
  const unchanged = JSON.stringify(liveMessages)
  const live = renderOpenTools(liveMessages)
  expect(live.querySelector("[data-tool-call-toggle]")?.textContent).toContain("选择网页选项")
  expect(live.querySelector("[data-tool-call-entry] pre")?.textContent).toBe("网页选项已选择")
  expect(live.textContent).not.toContain(privateSelectSelector)
  expect(live.textContent).not.toContain("selected_values")
  expect(live.textContent).not.toContain("awaiting_permission_approval")
  expect(JSON.stringify(liveMessages)).toBe(unchanged)

  const failed = renderOpenTools(browserMessages(parameters, result, true))
  expect(failed.querySelector("[data-tool-call-entry] pre")?.textContent).toBe("网页选项选择失败")

  const history = mapHistoryMessagesToUi("session-159", [
    {
      id: "assistant-large-select", role: "assistant", content: "",
      tool_calls: [{ id: "select-large", type: "function", function: { name: "default::browser", arguments: JSON.stringify(parameters) } }],
      created_at: "2026-09-24T00:00:00Z",
    },
    { id: "result-large-select", role: "tool", tool_call_id: "select-large", content: result, created_at: "2026-09-24T00:00:01Z" },
  ])
  const restored = renderOpenTools(history)
  expect(restored.querySelector("[data-tool-call-toggle]")?.textContent).toContain("选择网页选项")
  expect(restored.querySelector("[data-tool-call-entry] pre")?.textContent).toBe("网页选项已选择")
  expect(restored.textContent).not.toContain(privateSelectSelector)
  expect(restored.textContent).not.toContain("selected_values")
  expect(JSON.stringify(history)).toContain(privateSelectSelector)

  const approval = renderOpenTools(browserMessages(parameters, JSON.stringify({
    status: "awaiting_permission_approval",
    permission_request: { resource: privateSelectResource, padding: escapedValue.repeat(6) },
  })))
  expect(approval.querySelector("[data-tool-call-entry] pre")?.textContent).toBe("等待用户批准")
  expect(approval.textContent).not.toContain(privateSelectResource)

  const malformedResult = renderOpenTools(browserMessages(parameters, result.slice(0, -1)))
  expect(malformedResult.querySelector("[data-tool-call-entry] pre")).toBeNull()
  expect(malformedResult.textContent).not.toContain(privateSelectSelector)
})

it("shows a safe failure status and omits malformed select_option previews", () => {
  const failed = renderOpenTools(browserMessages(
    { action: "select_option", selector: privateSelectSelector, values: [privateSelectValue] },
    JSON.stringify({ error: privateSelectValue, selected_values: [privateSelectValue] }),
    true,
  ))
  expect(failed.querySelector("[data-tool-call-entry] pre")?.textContent).toBe("网页选项选择失败")
  expect(failed.textContent).not.toContain(privateSelectValue)
  expect(failed.textContent).not.toContain(privateSelectSelector)

  const malformed = renderOpenTools(browserMessages(
    { raw: `{"action":"select_option","values":["${privateSelectValue}"]` },
    `{"selected_values":["${privateSelectValue}"`,
  ))
  expect(malformed.textContent).not.toContain(privateSelectValue)
  expect(malformed.querySelector("[data-tool-call-entry] pre")).toBeNull()

  const oversized = renderOpenTools(browserMessages(
    { action: "select_option", values: [privateSelectValue.repeat(1000)] },
    JSON.stringify({ selected_values: [privateSelectValue.repeat(1000)] }),
    true,
  ))
  expect(oversized.textContent).not.toContain(privateSelectValue)
  expect(oversized.querySelector("[data-tool-call-entry] pre")?.textContent).toBe("网页选项选择失败")
})

it.each(["browser", "default::browser"])("hides small %s set_file_input payloads and results in live ToolCalls", (toolName) => {
  expect(JSON.stringify(fileInputParameters).length).toBeLessThan(16 * 1024)
  const messages = browserMessages(
    fileInputParameters,
    JSON.stringify({ ok: true, filename: privateFileName, mime_type: privateFileMimeType, data_base64: privateFileBytes }),
    false,
    toolName,
  )
  const unchanged = JSON.stringify(messages)
  const host = renderOpenTools(messages)

  expect(host.querySelector("[data-tool-call-toggle]")?.textContent).toContain("设置网页文件")
  expect(host.querySelector("[data-tool-call-entry] pre")?.textContent).toBe("网页文件已设置")
  for (const value of ["set_file_input", privateFileBytes, privateFileName, privateFileMimeType, privateFileSelector, "data_base64"]) {
    expect(host.textContent).not.toContain(value)
  }
  expect(JSON.stringify(messages)).toBe(unchanged)
})

it.each([
  { toolName: "browser", isError: false, expected: "网页文件已设置" },
  { toolName: "default::browser", isError: true, expected: "网页文件设置失败" },
])("keeps the fixed file action and $expected status above the preview limit", ({ toolName, isError, expected }) => {
  const parameters = { ...fileInputParameters, data_base64: largeFileBytes }
  expect(atob(largeFileBytes).length).toBe(15_000)
  expect(JSON.stringify(parameters).length).toBeGreaterThan(16 * 1024)
  const messages = browserMessages(
    parameters,
    JSON.stringify(isError ? { error: privateFileName } : { ok: true, filename: privateFileName }),
    isError,
    toolName,
  )
  const unchanged = JSON.stringify(messages)
  const host = renderOpenTools(messages)

  expect(unchanged).toContain(largeFileBytes)
  expect(host.querySelector("[data-tool-call-toggle]")?.textContent).toContain("设置网页文件")
  expect(host.querySelector("[data-tool-call-entry] pre")?.textContent).toBe(expected)
  for (const value of ["set_file_input", largeFileBytes.slice(0, 32), privateFileName, privateFileMimeType, privateFileSelector, "data_base64"]) {
    expect(host.textContent).not.toContain(value)
  }
  expect(JSON.stringify(messages)).toBe(unchanged)
})

it("hides file bytes, metadata, and approval fingerprint after history mapping", () => {
  const rawArguments = JSON.stringify(fileInputParameters)
  const approval = JSON.stringify({
    status: "awaiting_permission_approval",
    permission_request: { resource: privateFileResource, suggested_matchers: [{ value: privateFileName }] },
  })
  const selected = JSON.stringify({ ok: true, filename: privateFileName, data_base64: privateFileBytes })
  const messages = mapHistoryMessagesToUi("session-155", [
    {
      id: "assistant-call",
      role: "assistant",
      content: "",
      tool_calls: [
        { id: "file-result", type: "function", function: { name: "browser", arguments: rawArguments } },
        { id: "file-approval", type: "function", function: { name: "default::browser", arguments: rawArguments } },
      ],
      created_at: "2026-09-24T00:00:00Z",
    },
    { id: "tool-result", role: "tool", tool_call_id: "file-result", content: selected, created_at: "2026-09-24T00:00:01Z" },
    { id: "tool-approval", role: "tool", tool_call_id: "file-approval", content: approval, created_at: "2026-09-24T00:00:02Z" },
  ])
  const unchanged = JSON.stringify(messages)
  const host = renderOpenTools(messages)

  expect(unchanged).toContain(privateFileBytes)
  expect(unchanged).toContain(privateFileResource)
  expect(host.querySelectorAll("[data-tool-call-entry]")).toHaveLength(2)
  expect(Array.from(host.querySelectorAll("[data-tool-call-entry] pre"), (node) => node.textContent))
    .toEqual(["网页文件已设置", "等待用户批准"])
  for (const value of ["set_file_input", privateFileBytes, privateFileName, privateFileMimeType, privateFileSelector, privateFileResource, "permission_request"]) {
    expect(host.textContent).not.toContain(value)
  }
  expect(JSON.stringify(messages)).toBe(unchanged)
})

it("shows a safe set_file_input failure and omits malformed or oversized file previews", () => {
  const failed = renderOpenTools(browserMessages(
    fileInputParameters,
    JSON.stringify({ error: privateFileBytes, filename: privateFileName }),
    true,
  ))
  expect(failed.querySelector("[data-tool-call-entry] pre")?.textContent).toBe("网页文件设置失败")
  for (const value of [privateFileBytes, privateFileName, privateFileMimeType, privateFileSelector]) {
    expect(failed.textContent).not.toContain(value)
  }

  const malformed = renderOpenTools(browserMessages(
    { raw: `{"action":"set_file_input","data_base64":"${privateFileBytes}"` },
    `{"filename":"${privateFileName}"`,
  ))
  expect(malformed.textContent).not.toContain(privateFileBytes)
  expect(malformed.textContent).not.toContain(privateFileName)
  expect(malformed.querySelector("[data-tool-call-entry] pre")).toBeNull()

  const oversized = renderOpenTools(browserMessages(
    { ...fileInputParameters, data_base64: privateFileBytes.repeat(1000) },
    JSON.stringify({ data_base64: privateFileBytes.repeat(1000) }),
  ))
  expect(oversized.querySelector("[data-tool-call-toggle]")?.textContent).toContain("设置网页文件")
  expect(oversized.textContent).not.toContain(privateFileBytes)
  expect(oversized.textContent).not.toContain(privateFileName)
  expect(oversized.querySelector("[data-tool-call-entry] pre")).toBeNull()
})

it("hides browser_eval code, target URL, and page result in live ToolCalls", () => {
  const messages = browserEvalMessages(
    { code: privateEvalCode, expected_url: privateEvalUrl, expected_epoch: 17 },
    JSON.stringify({ ok: true, value: privateEvalResult, url: privateEvalUrl }),
  )
  const unchanged = JSON.stringify(messages)
  const host = renderOpenTools(messages)

  expect(host.textContent).toContain("执行网页脚本")
  expect(host.textContent).toContain("网页脚本已执行")
  for (const privateValue of [privateEvalCode, privateEvalUrl, privateEvalResult]) {
    expect(host.textContent).not.toContain(privateValue)
  }
  expect(JSON.stringify(messages)).toBe(unchanged)
})

it.each([
  [
    "failed execution",
    JSON.stringify({ error: privateEvalResult, url: privateEvalUrl }),
    true,
    "网页脚本执行失败",
  ],
  [
    "parked approval",
    JSON.stringify({
      status: "awaiting_permission_approval",
      permission_request: { resource: privateEvalResource, suggested_matchers: [{ value: privateEvalCode }] },
    }),
    false,
    "等待用户批准",
  ],
])("hides %s for a namespaced browser_eval call", (_case, result, isError, expectedStatus) => {
  const host = renderOpenTools(browserEvalMessages(
    { code: privateEvalCode, expected_url: privateEvalUrl, expected_epoch: 17 },
    result,
    isError,
    "default::browser_eval",
  ))

  expect(host.textContent).toContain(expectedStatus)
  for (const privateValue of [privateEvalCode, privateEvalUrl, privateEvalResult, privateEvalResource]) {
    expect(host.textContent).not.toContain(privateValue)
  }
})

it("keeps browser_eval source and result private after history mapping", () => {
  const rawArguments = JSON.stringify({
    code: privateEvalCode,
    expected_url: privateEvalUrl,
    expected_epoch: 17,
  })
  const rawResult = JSON.stringify({ ok: true, value: privateEvalResult, url: privateEvalUrl })
  const messages = mapHistoryMessagesToUi("session-151", [
    {
      id: "assistant-call",
      role: "assistant",
      content: "",
      tool_calls: [{ id: "browser-eval-call", type: "function", function: { name: "browser_eval", arguments: rawArguments } }],
      created_at: "2026-09-20T00:00:00Z",
    },
    {
      id: "tool-result",
      role: "tool",
      tool_call_id: "browser-eval-call",
      content: rawResult,
      created_at: "2026-09-20T00:00:01Z",
    },
  ])
  const host = renderOpenTools(messages)

  expect(JSON.stringify(messages)).toContain(privateEvalCode)
  expect(JSON.stringify(messages)).toContain(privateEvalResult)
  expect(host.textContent).toContain("网页脚本已执行")
  for (const privateValue of [privateEvalCode, privateEvalUrl, privateEvalResult]) {
    expect(host.textContent).not.toContain(privateValue)
  }
})

it("omits malformed and oversized browser_eval previews while ordinary tools still render", () => {
  const malformed = renderOpenTools(browserEvalMessages(
    { raw: `{"code":"${privateEvalCode}"` },
    `{"error":"${privateEvalResult}"`,
    true,
  ))
  expect(malformed.textContent).not.toContain(privateEvalCode)
  expect(malformed.textContent).not.toContain(privateEvalResult)
  expect(malformed.querySelector("[data-tool-call-entry] pre")).toBeNull()

  const oversized = renderOpenTools(browserEvalMessages(
    { code: privateEvalCode.repeat(1000), expected_url: privateEvalUrl },
    JSON.stringify({ value: privateEvalResult.repeat(1000) }),
  ))
  expect(oversized.textContent).not.toContain(privateEvalCode)
  expect(oversized.textContent).not.toContain(privateEvalResult)
  expect(oversized.querySelector("[data-tool-call-entry] pre")).toBeNull()

  const ordinary = renderOpenTools(toolMessages(true))
  expect(ordinary.textContent).toContain("/tmp/example.ts")
  expect(ordinary.textContent).toContain("done")
})
