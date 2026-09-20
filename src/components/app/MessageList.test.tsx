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
vi.mock("@/components/chat/Reasoning", () => ({
  Reasoning: ({ text }: { text: string }) => <div data-reasoning={text}>{text}</div>,
}))
vi.mock("@/components/chat/StreamingReasoning", () => ({ StreamingReasoning: () => null }))
vi.mock("@/components/chat/SubAgents", () => ({ SubAgents: () => null }))
vi.mock("@/components/chat/ToolCalls", () => ({
  ToolCalls: ({ active, items }: { active?: boolean; items: Message[] }) => (
    <div data-tool-active={String(active)} data-tool-items={items.length} />
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

function renderMessageList(messages: Message[], latestRunFinished: boolean) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  mountedRoots.push(root)
  act(() => {
    root.render(
      <MessageList
        scrollRef={createRef<HTMLDivElement>()}
        contentRef={createRef<HTMLDivElement>()}
        onScroll={vi.fn()}
        messages={messages}
        mergedSubAgents={{}}
        sending={false}
        latestRunFinished={latestRunFinished}
        streaming={null}
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
  return container
}

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
          latestRunFinished={false}
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
          latestRunFinished={false}
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
          latestRunFinished={false}
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

function toolTurn(prefix: string, start: string, finish: string): Message[] {
  return [
    {
      id: `${prefix}-user`,
      role: "user",
      content: `${prefix} request`,
      createdAt: start,
    },
    {
      id: `${prefix}-process`,
      role: "assistant",
      type: "text",
      content: `${prefix} process`,
      createdAt: "2026-09-20T00:00:10Z",
    },
    {
      id: `${prefix}-call`,
      role: "assistant",
      type: "tool_call",
      toolCalls: [{ toolCallId: `${prefix}-tool`, toolName: "Read", parameters: {} }],
      createdAt: "2026-09-20T00:00:20Z",
    },
    {
      id: `${prefix}-result`,
      role: "assistant",
      type: "tool_result",
      toolName: "Read",
      toolCallId: `${prefix}-tool`,
      result: { tool_name: "Read", result: "done", display_preference: "Default" },
      isError: false,
      createdAt: "2026-09-20T00:00:30Z",
    },
    {
      id: `${prefix}-final`,
      role: "assistant",
      type: "text",
      content: `${prefix} final`,
      metadata: { reasoning: `${prefix} final reasoning` },
      createdAt: finish,
    },
  ] as Message[]
}

describe("MessageList completed process disclosure", () => {
  it("folds the latest finished tool process while keeping its final answer visible", () => {
    const container = renderMessageList(
      toolTurn("latest", "2026-09-20T00:00:00Z", "2026-09-20T00:01:05Z"),
      true,
    )

    const process = container.querySelector<HTMLDetailsElement>("details[data-completed-process]")
    expect(process).not.toBeNull()
    expect(process?.open).toBe(false)
    expect(process?.querySelector("summary")?.textContent).toBe("处理了 1分5秒")
    expect(process?.querySelector("summary")?.getAttribute("title")).toBe("1 次工具调用")
    expect(process?.querySelector('[data-assistant-content="latest process"]')).not.toBeNull()
    expect(process?.querySelector('[data-reasoning="latest final reasoning"]')).not.toBeNull()
    const final = container.querySelector('[data-assistant-content="latest final"]')
    expect(final).not.toBeNull()
    expect(process?.contains(final)).toBe(false)
    expect(container.querySelectorAll('[data-reasoning="latest final reasoning"]')).toHaveLength(1)

    act(() => process?.querySelector("summary")?.click())
    expect(process?.open).toBe(true)
  })

  it("does not fold the latest process before the run finishes normally", () => {
    const container = renderMessageList(
      toolTurn("active", "2026-09-20T00:00:00Z", "2026-09-20T00:01:05Z"),
      false,
    )

    expect(container.querySelector("details[data-completed-process]")).toBeNull()
    expect(container.querySelector('[data-assistant-content="active process"]')).not.toBeNull()
    expect(container.querySelector('[data-assistant-content="active final"]')).not.toBeNull()
    expect(container.querySelector('[data-reasoning="active final reasoning"]')).not.toBeNull()
  })

  it("keeps an earlier completed process folded while a newer turn is unfinished", () => {
    const earlier = toolTurn(
      "earlier",
      "2026-09-20T00:00:00Z",
      "2026-09-20T00:01:05Z",
    )
    const latest: Message[] = [
      {
        id: "new-user",
        role: "user",
        content: "new request",
        createdAt: "2026-09-20T00:02:00Z",
      },
      {
        id: "new-response",
        role: "assistant",
        type: "text",
        content: "new response",
        createdAt: "2026-09-20T00:02:05Z",
      },
    ]
    const container = renderMessageList([...earlier, ...latest], false)

    const disclosures = container.querySelectorAll("details[data-completed-process]")
    expect(disclosures).toHaveLength(1)
    expect(disclosures[0]?.querySelector('[data-assistant-content="earlier process"]')).not.toBeNull()
    expect(disclosures[0]?.contains(container.querySelector('[data-assistant-content="earlier final"]'))).toBe(false)
    expect(container.querySelector('[data-assistant-content="new response"]')).not.toBeNull()
  })
})
