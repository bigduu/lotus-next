import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  messageListProps: null as Record<string, unknown> | null,
  retry: vi.fn(),
  truncated: false,
  useChat: vi.fn(() => {
    throw new Error("SubagentTranscriptPane must not use the full-fidelity chat hook")
  }),
}))

vi.mock("@/hooks/useChat", () => ({ useChat: mocks.useChat }))
vi.mock("@/hooks/useSubagentTranscript", () => ({
  useSubagentTranscript: () => ({
    messages: [
      {
        id: "user-1",
        role: "user",
        content: "question",
        createdAt: "2026-09-22T00:00:00Z",
      },
      {
        id: "assistant-1",
        role: "assistant",
        type: "text",
        content: "answer",
        createdAt: "2026-09-22T00:00:01Z",
      },
    ],
    loading: false,
    error: null,
    truncated: mocks.truncated,
    streaming: true,
    retry: mocks.retry,
  }),
}))
vi.mock("@/hooks/useStickyScroll", () => ({
  useStickyScroll: () => ({
    scrollRef: vi.fn(),
    contentRef: vi.fn(),
    atBottom: true,
    handleScroll: vi.fn(),
    scrollToBottom: vi.fn(),
  }),
}))
vi.mock("@/components/app/MessageList", () => ({
  MessageList: (props: Record<string, unknown>) => {
    mocks.messageListProps = props
    return <div data-safe-message-list />
  },
}))
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: () => null,
}))

import { SubagentTranscriptPane } from "./SubagentTranscriptPane"

let root: Root | null = null
let container: HTMLDivElement | null = null

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  mocks.messageListProps = null
  mocks.retry.mockReset()
  mocks.truncated = false
  mocks.useChat.mockClear()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  vi.unstubAllGlobals()
})

it("renders only the safe message projection without generic chat state", () => {
  act(() => {
    root?.render(
      <SubagentTranscriptPane
        sessionId="child-1"
        chats={[
          {
            id: "child-1",
            title: "Child",
            parentSessionId: "root-1",
            createdAt: 0,
            messages: [],
            config: {
              systemPromptId: "",
              baseSystemPrompt: "",
              lastUsedEnhancedPrompt: null,
            },
          },
        ]}
        onPickSession={vi.fn()}
      />,
    )
  })

  expect(mocks.useChat).not.toHaveBeenCalled()
  expect(mocks.messageListProps).toMatchObject({
    readOnly: true,
    mergedSubAgents: {},
    streamingReasoning: null,
    liveSegments: [],
    streamStatus: null,
    pendingUserText: null,
  })
  expect(mocks.messageListProps?.messages).toEqual([
    {
      id: "user-1",
      role: "user",
      content: "question",
      createdAt: "2026-09-22T00:00:00Z",
    },
    {
      id: "assistant-1",
      role: "assistant",
      type: "text",
      content: "answer",
      createdAt: "2026-09-22T00:00:01Z",
    },
  ])
  expect(container?.querySelector("[data-safe-message-list]")).not.toBeNull()
})

it("explains when older child messages were omitted", () => {
  mocks.truncated = true
  act(() => {
    root?.render(
      <SubagentTranscriptPane sessionId="child-1" chats={[]} onPickSession={vi.fn()} />,
    )
  })
  expect(container?.querySelector('[role="status"]')?.textContent).toContain("较早的子代理消息已省略")
})
