import { act, createRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("@/components/chat/AssistantMarkdown", () => ({
  AssistantMarkdown: ({
    children,
    isStreaming,
  }: {
    children: string
    isStreaming?: boolean
  }) => (
    <div data-assistant-content={children} data-streaming={String(isStreaming)}>
      {children}
    </div>
  ),
}))
vi.mock("@/components/chat/Reasoning", () => ({ Reasoning: () => null }))
vi.mock("@/components/chat/StreamingReasoning", () => ({ StreamingReasoning: () => null }))
vi.mock("@/components/chat/SubAgents", () => ({ SubAgents: () => null }))
vi.mock("@/components/chat/ToolCalls", () => ({
  ToolCalls: ({ active }: { active?: boolean }) => (
    <div data-tool-active={String(active)} />
  ),
}))

import { MessageList } from "./MessageList"
import type { Message } from "@shared/types/chatMessages"

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

describe("MessageList assistant streaming ownership", () => {
  it("renders persisted and frozen text statically, and only the active tail as streaming", () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    mountedRoots.push(root)
    const persisted: Message = {
      id: "persisted",
      role: "assistant",
      type: "text",
      content: "persisted assistant",
      createdAt: "2026-09-01T00:00:00Z",
    }

    act(() => {
      root.render(
        <MessageList
          scrollRef={createRef<HTMLDivElement>()}
          contentRef={createRef<HTMLDivElement>()}
          onScroll={vi.fn()}
          messages={[persisted]}
          mergedSubAgents={{}}
          sending
          streaming="active tail"
          streamingActive
          streamingReasoning={null}
          liveSegments={[{ kind: "text", text: "frozen round", reasoning: null }]}
          streamStatus={null}
          pendingUserText={null}
          forking={false}
          onSelectSubAgent={vi.fn()}
          onPreviewImage={vi.fn()}
          onRegenerate={vi.fn()}
          onFork={vi.fn()}
          onDelete={vi.fn()}
          onEditMessage={vi.fn()}
        />,
      )
    })

    const modes = Object.fromEntries(
      [...container.querySelectorAll<HTMLElement>("[data-assistant-content]")].map((node) => [
        node.dataset.assistantContent,
        node.dataset.streaming,
      ]),
    )
    expect(modes).toEqual({
      "persisted assistant": "false",
      "frozen round": "false",
      "active tail": "true",
    })
  })

  it("keeps user bubbles colored while assistant surfaces stay transparent", () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    mountedRoots.push(root)
    const user: Message = {
      id: "user",
      role: "user",
      content: "user bubble",
      createdAt: "2026-09-01T00:00:00Z",
    }
    const assistant: Message = {
      id: "assistant",
      role: "assistant",
      type: "text",
      content: "assistant response",
      createdAt: "2026-09-01T00:00:01Z",
    }

    act(() => {
      root.render(
        <MessageList
          scrollRef={createRef<HTMLDivElement>()}
          contentRef={createRef<HTMLDivElement>()}
          onScroll={vi.fn()}
          messages={[user, assistant]}
          mergedSubAgents={{}}
          sending
          streaming="streaming response"
          streamingActive
          streamingReasoning={null}
          liveSegments={[{ kind: "text", text: "frozen response", reasoning: null }]}
          streamStatus={null}
          pendingUserText={null}
          forking={false}
          onSelectSubAgent={vi.fn()}
          onPreviewImage={vi.fn()}
          onRegenerate={vi.fn()}
          onFork={vi.fn()}
          onDelete={vi.fn()}
          onEditMessage={vi.fn()}
        />,
      )
    })

    const userSurface = container.querySelector<HTMLElement>('[data-message-role="user"]')
    expect(userSurface?.classList.contains("bg-primary")).toBe(true)

    const assistantSurfaces = container.querySelectorAll<HTMLElement>(
      '[data-message-role="assistant"]',
    )
    expect(assistantSurfaces).toHaveLength(3)
    for (const surface of assistantSurfaces) {
      expect(surface.classList.contains("bg-transparent")).toBe(true)
      expect(surface.classList.contains("bg-muted")).toBe(false)
      expect(surface.classList.contains("text-[15px]")).toBe(true)
      expect(surface.classList.contains("font-medium")).toBe(true)
    }
  })

  it("does not animate a persisted tool round from retained stream content alone", () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    mountedRoots.push(root)
    const toolCall = {
      id: "persisted-tool",
      role: "assistant",
      type: "tool_call",
      toolCalls: [{ toolCallId: "call-1", toolName: "Read", parameters: {} }],
      createdAt: "2026-09-01T00:00:00Z",
    } as unknown as Message

    act(() => {
      root.render(
        <MessageList
          scrollRef={createRef<HTMLDivElement>()}
          contentRef={createRef<HTMLDivElement>()}
          onScroll={vi.fn()}
          messages={[toolCall]}
          mergedSubAgents={{}}
          sending={false}
          streaming="retained final text"
          streamingActive={false}
          streamingReasoning={null}
          liveSegments={[]}
          streamStatus={null}
          pendingUserText={null}
          forking={false}
          onSelectSubAgent={vi.fn()}
          onPreviewImage={vi.fn()}
          onRegenerate={vi.fn()}
          onFork={vi.fn()}
          onDelete={vi.fn()}
          onEditMessage={vi.fn()}
        />,
      )
    })

    expect(container.querySelector("[data-tool-active]")?.getAttribute("data-tool-active"))
      .toBe("false")
    expect(container.querySelector("[data-assistant-content='retained final text']")
      ?.getAttribute("data-streaming")).toBe("false")
  })
})
