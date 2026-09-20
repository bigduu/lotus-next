import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterAll, afterEach, beforeAll, expect, it } from "vitest"
import type { Message } from "@shared/types/chatMessages"
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
