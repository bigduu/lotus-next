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

it("starts active tool calls collapsed and preserves a manual expansion after completion", () => {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  mountedRoots.push(root)

  act(() => root.render(<ToolCalls items={toolMessages()} active />))

  const toggle = host.querySelector<HTMLButtonElement>("button[aria-expanded]")
  expect(toggle?.getAttribute("aria-expanded")).toBe("false")
  expect(host.textContent).not.toContain("/tmp/example.ts")

  act(() => toggle?.click())
  expect(toggle?.getAttribute("aria-expanded")).toBe("true")
  expect(host.textContent).toContain("/tmp/example.ts")

  act(() => root.render(<ToolCalls items={toolMessages(true)} active={false} />))
  expect(toggle?.getAttribute("aria-expanded")).toBe("true")
  expect(host.textContent).toContain("done")
})
