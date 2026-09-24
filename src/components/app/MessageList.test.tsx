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
  ToolCalls: ({
    active,
    items,
    runningCallIds,
    open = false,
    onOpenChange,
  }: {
    active?: boolean
    items: Message[]
    runningCallIds?: ReadonlySet<string>
    open?: boolean
    onOpenChange?: (open: boolean) => void
  }) => (
    <button
      type="button"
      aria-expanded={open}
      data-tool-active={String(active)}
      data-tool-items={items.length}
      data-running-calls={[...(runningCallIds ?? [])].join(",")}
      onClick={() => onOpenChange?.(!open)}
    />
  ),
}))

import { MessageList } from "./MessageList"
import type { Message } from "@shared/types/chatMessages"
import type { LiveSegment } from "@/hooks/useChat"

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

function renderMessageList(
  messages: Message[],
  latestRunFinished: boolean,
  contentShiftX = 0,
  readOnly = false,
  liveSegments: LiveSegment[] = [],
) {
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
        sending={liveSegments.length > 0}
        latestRunFinished={latestRunFinished}
        streaming={null}
        streamingActive={false}
        streamingReasoning={null}
        liveSegments={liveSegments}
        streamStatus={null}
        pendingUserText={null}
        contentShiftX={contentShiftX}
        readOnly={readOnly}
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

it("passes exact running call IDs even when a live call has partial output", () => {
  const container = renderMessageList([], false, 0, false, [{
    kind: "tools",
    calls: [
      { toolCallId: "still-running", toolName: "Read", output: "partial output", status: "running" },
      { toolCallId: "already-done", toolName: "Read", output: "final output", status: "completed" },
    ],
  }])

  const group = container.querySelector<HTMLElement>("[data-tool-active]")
  expect(group?.dataset.toolActive).toBe("true")
  expect(group?.dataset.toolItems).toBe("4")
  expect(group?.dataset.runningCalls).toBe("still-running")
})

it("animates only the transcript content when a floating panel opens", () => {
  const container = renderMessageList([], false, -166)
  const scrollViewport = container.firstElementChild as HTMLElement | null
  const content = container.querySelector<HTMLElement>("[data-message-list-content]")

  expect(scrollViewport?.style.transform).toBe("")
  expect(content?.style.transform).toBe("")
  expect(content?.style.left).toBe("-166px")
  expect(content?.style.transition).toContain("left 200ms ease-out")
})

it("renders message-only previews without transcript actions", () => {
  const container = renderMessageList([
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
  ], true, 0, true)

  expect(container.textContent).toContain("question")
  expect(container.textContent).toContain("answer")
  expect(container.querySelector("[data-message-actions]")).toBeNull()
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
      expect(surface.classList.contains("text-base")).toBe(true)
      expect(surface.classList.contains("font-normal")).toBe(true)
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

describe("MessageList compact message actions", () => {
  it("keeps controls beside messages and only shows them for the final assistant response", () => {
    const messages: Message[] = [
      {
        id: "user-1",
        role: "user",
        content: "first request",
        createdAt: "2026-09-20T00:00:00Z",
      },
      {
        id: "assistant-process",
        role: "assistant",
        type: "text",
        content: "working on it",
        createdAt: "2026-09-20T00:00:01Z",
      },
      {
        id: "assistant-final-1",
        role: "assistant",
        type: "text",
        content: "first answer",
        createdAt: "2026-09-20T00:00:02Z",
      },
      {
        id: "user-2",
        role: "user",
        content: "second request",
        createdAt: "2026-09-20T00:01:00Z",
      },
      {
        id: "assistant-final-2",
        role: "assistant",
        type: "text",
        content: "second answer",
        createdAt: "2026-09-20T00:01:01Z",
      },
    ]
    const container = renderMessageList(messages, false)

    const actionIds = [...container.querySelectorAll<HTMLElement>("[data-message-actions]")]
      .map((node) => node.dataset.messageActions)
    expect(actionIds).toEqual(["user-1", "assistant-final-1", "user-2", "assistant-final-2"])
    expect(container.querySelector('[data-message-actions="assistant-process"]')).toBeNull()

    const userRow = container.querySelector<HTMLElement>('[data-message-row="user-1"]')
    const userActions = userRow?.querySelector<HTMLElement>('[data-message-actions="user-1"]')
    expect(userRow?.classList.contains("flex-col")).toBe(false)
    expect(userActions?.nextElementSibling?.getAttribute("data-message-role")).toBe("user")

    const assistantRow = container.querySelector<HTMLElement>(
      '[data-message-row="assistant-final-1"]',
    )
    const assistantActions = assistantRow?.querySelector<HTMLElement>(
      '[data-message-actions="assistant-final-1"]',
    )
    expect(assistantActions?.previousElementSibling?.getAttribute("data-message-role"))
      .toBe("assistant")
    expect(assistantActions?.classList.contains("mt-1")).toBe(false)
    expect(assistantActions?.querySelector('[aria-label="复制"]')?.classList.contains("hidden"))
      .toBe(true)
    expect(assistantActions?.querySelector('[aria-label="更多消息操作"]')).not.toBeNull()
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
    expect(process?.querySelector('[data-assistant-content="latest process"]')).toBeNull()
    expect(process?.querySelector('[data-reasoning="latest final reasoning"]')).toBeNull()
    const final = container.querySelector('[data-assistant-content="latest final"]')
    expect(final).not.toBeNull()
    expect(process?.contains(final)).toBe(false)
    expect(container.querySelectorAll('[data-reasoning="latest final reasoning"]')).toHaveLength(0)
    const collapsedHeight = Number.parseFloat(
      container.querySelector<HTMLElement>("[data-virtual-history]")?.style.height || "0",
    )

    act(() => process?.querySelector("summary")?.click())
    expect(process?.open).toBe(true)
    expect(process?.querySelector('[data-assistant-content="latest process"]')).not.toBeNull()
    expect(process?.querySelector('[data-reasoning="latest final reasoning"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-reasoning="latest final reasoning"]')).toHaveLength(1)
    const expandedHeight = Number.parseFloat(
      container.querySelector<HTMLElement>("[data-virtual-history]")?.style.height || "0",
    )
    expect(expandedHeight).toBeGreaterThan(collapsedHeight)
  })

  it("keeps sibling measurements when one tool group expands", () => {
    const heightSpy = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get")
      .mockImplementation(function (this: HTMLElement) {
        const key = this.dataset.historyEntryKey
        if (key === "message-latest-user") return 52
        if (key === "message-latest-process") return 44
        if (key === "tools-latest-call") {
          return this.querySelector('[aria-expanded="true"]') ? 293 : 25
        }
        if (key === "message-latest-final") return 640
        return 0
      })

    try {
      const container = renderMessageList(
        toolTurn("latest", "2026-09-20T00:00:00Z", "2026-09-20T00:01:05Z"),
        false,
      )
      const finalRow = container.querySelector<HTMLElement>(
        '[data-history-entry-key="message-latest-final"]',
      )!
      const toolToggle = container.querySelector<HTMLButtonElement>('[data-tool-items="2"]')!
      const initialTop = Number.parseFloat(finalRow.style.transform.match(/[\d.]+/)?.[0] ?? "0")

      act(() => toolToggle.click())

      const expandedTop = Number.parseFloat(finalRow.style.transform.match(/[\d.]+/)?.[0] ?? "0")
      expect(toolToggle.getAttribute("aria-expanded")).toBe("true")
      expect(expandedTop - initialTop).toBe(268)
    } finally {
      heightSpy.mockRestore()
    }
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
    expect(disclosures[0]?.querySelector('[data-assistant-content="earlier process"]')).toBeNull()
    expect(disclosures[0]?.contains(container.querySelector('[data-assistant-content="earlier final"]'))).toBe(false)
    expect(container.querySelector('[data-assistant-content="new response"]')).not.toBeNull()

    act(() => disclosures[0]?.querySelector("summary")?.click())
    expect(disclosures[0]?.querySelector('[data-assistant-content="earlier process"]')).not.toBeNull()
  })
})

function plainHistory(count: number): Message[] {
  return Array.from({ length: count }, (_, index) =>
    index % 2 === 0
      ? {
          id: `user-${index}`,
          role: "user" as const,
          content: `request ${index}`,
          createdAt: new Date(1_700_000_000_000 + index * 1_000).toISOString(),
        }
      : {
          id: `assistant-${index}`,
          role: "assistant" as const,
          type: "text" as const,
          content: `response ${index}`,
          createdAt: new Date(1_700_000_000_000 + index * 1_000).toISOString(),
        },
  )
}

function scrollVirtualList(container: HTMLElement, top: number) {
  const scrollElement = container.firstElementChild as HTMLDivElement
  act(() => {
    scrollElement.scrollTop = top
    scrollElement.dispatchEvent(new Event("scroll"))
  })
}

describe("MessageList history virtualization", () => {
  it("mounts only a window of long history while keeping the live tail outside it", () => {
    const messages = plainHistory(200)
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
          sending
          latestRunFinished={false}
          streaming="active tail"
          streamingActive
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

    const virtualHistory = container.querySelector<HTMLElement>("[data-virtual-history]")
    expect(virtualHistory).not.toBeNull()
    const initialRows = virtualHistory!.querySelectorAll("[data-history-entry-key]")
    expect(initialRows.length).toBeGreaterThan(0)
    expect(initialRows.length).toBeLessThan(40)
    expect(virtualHistory?.querySelector('[data-history-entry-key="message-user-0"]')).not.toBeNull()
    const liveTail = container.querySelector('[data-assistant-content="active tail"]')
    expect(liveTail).not.toBeNull()
    expect(virtualHistory?.contains(liveTail)).toBe(false)

    const totalHeight = Number.parseFloat(virtualHistory!.style.height)
    scrollVirtualList(container, totalHeight - 720)

    expect(virtualHistory?.querySelector('[data-history-entry-key="message-user-0"]')).toBeNull()
    expect(
      virtualHistory?.querySelector('[data-history-entry-key="message-assistant-199"]'),
    ).not.toBeNull()
    expect(container.querySelector('[data-assistant-content="active tail"]')).not.toBeNull()
  })

  it("preserves an expanded process after its virtual row unmounts and remounts", () => {
    const messages = [
      ...toolTurn("virtual", "2026-09-20T00:00:00Z", "2026-09-20T00:01:05Z"),
      ...plainHistory(160).map((message, index) => ({
        ...message,
        id: `later-${index}`,
        createdAt: new Date(1_800_000_000_000 + index * 1_000).toISOString(),
      })),
    ] as Message[]
    const container = renderMessageList(messages, false)
    const virtualHistory = container.querySelector<HTMLElement>("[data-virtual-history]")!
    let process = container.querySelector<HTMLDetailsElement>("details[data-completed-process]")
    expect(process).not.toBeNull()

    act(() => process?.querySelector("summary")?.click())
    expect(process?.open).toBe(true)
    expect(process?.querySelector('[data-assistant-content="virtual process"]')).not.toBeNull()

    scrollVirtualList(container, Number.parseFloat(virtualHistory.style.height) - 720)
    expect(container.querySelector("details[data-completed-process]")).toBeNull()

    scrollVirtualList(container, 0)
    process = container.querySelector<HTMLDetailsElement>("details[data-completed-process]")
    expect(process?.open).toBe(true)
    expect(process?.querySelector('[data-assistant-content="virtual process"]')).not.toBeNull()
  })
})
