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
vi.mock("@/components/chat/SubAgents", () => ({
  SubAgents: ({ agents, expandedIds, onExpandedChange }: { agents: Record<string, unknown>
    expandedIds?: ReadonlySet<string>; onExpandedChange?: (id: string, expanded: boolean) => void }) => Object.keys(agents).length
    ? <div data-subagent-group>{Object.keys(agents).map((id) => <div key={id} data-subagent-id={id}>
      <button type="button" aria-expanded={expandedIds?.has(id) ?? false}
        onClick={() => onExpandedChange?.(id, !expandedIds?.has(id))} />
    </div>)}</div> : null,
}))
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
import { mapHistoryMessagesToUi } from "@shared/store/appStore/slices/chatSessionSlice/messageMapping"
import { apiClient } from "@services/api"
import { uiText } from "@shared/i18n/ui"
import type { Message, MessageImage } from "@shared/types/chatMessages"
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
  pending?: { text: string; images: MessageImage[]; messages?: Parameters<typeof MessageList>[0]["pendingUserMessages"]; preview?: (src: string) => void },
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
        sending={false}
        latestRunFinished={latestRunFinished}
        streaming={null}
        streamingActive={false}
        streamingReasoning={null}
        liveSegments={[]}
        streamStatus={null}
        pendingUserText={pending?.text ?? null}
        pendingUserImages={pending?.images}
        pendingUserMessages={pending?.messages}
        forking={false}
        onSelectSubAgent={vi.fn()}
        onPreviewImage={pending?.preview ?? vi.fn()}
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
  it("shows a yielded parent's child wait without thinking and restores real model activity on resume", () => {
    const container = document.body.appendChild(document.createElement("div"))
    const root = createRoot(container)
    mountedRoots.push(root)
    const props: Parameters<typeof MessageList>[0] & { delegationWaiting?: boolean } = {
      scrollRef: createRef<HTMLDivElement>(), contentRef: createRef<HTMLDivElement>(),
      onScroll: vi.fn(), messages: [], mergedSubAgents: {}, sending: true,
      latestRunFinished: false, streaming: "", streamingActive: false,
      streamingReasoning: null, liveSegments: [], streamStatus: null,
      pendingUserText: null, forking: false, delegationWaiting: true,
      onSelectSubAgent: vi.fn(), onPreviewImage: vi.fn(), onRegenerate: vi.fn(),
      onFork: vi.fn(), onDelete: vi.fn(), onEditMessage: vi.fn(),
    }
    const render = (updates: Partial<typeof props> = {}) => act(() => {
      root.render(<MessageList {...props} {...updates} />)
    })
    render()
    expect(container.querySelector('[role="status"]')?.textContent).toBe(uiText("process_waiting_for_subagents"))
    expect(container.querySelector("[data-process-shimmer]")).toBeNull()
    expect(container.querySelector("[data-process-toggle]")).toBeNull()

    render({ delegationWaiting: false, streamingActive: true })
    expect(container.querySelector('[role="status"]')?.textContent).toBe(uiText("thinking_64088d8c"))
    expect(container.querySelector("[data-process-shimmer]")).not.toBeNull()

    render({ delegationWaiting: false, sending: false, streaming: null, latestRunFinished: true })
    expect(container.querySelector('[role="status"]')).toBeNull()
  })

  it("keeps the optimistic user visible while admission has no inspectable activity", () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    mountedRoots.push(root)
    const props: Parameters<typeof MessageList>[0] = {
      scrollRef: createRef<HTMLDivElement>(), contentRef: createRef<HTMLDivElement>(),
      onScroll: vi.fn(), messages: [], mergedSubAgents: {}, sending: true,
      latestRunFinished: false, streaming: "", streamingActive: true,
      streamingReasoning: null, liveSegments: [], streamStatus: null,
      pendingUserText: "My submitted message", forking: false,
      onSelectSubAgent: vi.fn(), onPreviewImage: vi.fn(), onRegenerate: vi.fn(),
      onFork: vi.fn(), onDelete: vi.fn(), onEditMessage: vi.fn(),
    }
    const render = (updates: Partial<typeof props> = {}) => act(() => {
      root.render(<MessageList {...props} {...updates} />)
    })
    const expectUser = () => {
      expect(container.querySelectorAll('[data-message-role="user"]')).toHaveLength(1)
      expect(container.querySelector("[data-pending-user-message]")?.textContent).toBe("My submitted message")
    }

    render()
    expectUser()
    expect(container.querySelector('[role="status"]')?.textContent).toBe(uiText("thinking_64088d8c"))
    expect(container.querySelector("[data-process-shimmer]")).not.toBeNull()
    expect(container.querySelector("[data-process-toggle]")).toBeNull()
    expect(container.querySelector("[data-process-content]")).toBeNull()
    render({ liveSegments: [{ kind: "tools", calls: [] }] })
    expectUser()
    expect(container.querySelector("[data-process-toggle]")).toBeNull()
    render({ streamStatus: "Preparing context" })
    expectUser()
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Preparing context")
    expect(container.querySelector("[data-process-toggle]")).toBeNull()
    expect(container.querySelector("[data-process-content]")).toBeNull()
    render({ streamingReasoning: "Checking the request." })
    expectUser()
    expect(container.querySelector("[data-process-toggle]")).not.toBeNull()
    expect(container.querySelector("[data-reasoning]")?.textContent).toBe("Checking the request.")
    const originalAnimate = HTMLElement.prototype.animate
    HTMLElement.prototype.animate = vi.fn(() => ({ finished: new Promise(() => {}), cancel: vi.fn() } as unknown as Animation))
    try {
      const runningTool: LiveSegment = { kind: "tools", calls: [{ toolCallId: "read", toolName: "Read", args: { file_path: "app.ts" }, output: "", status: "running" }] }
      render({ liveSegments: [runningTool], streamingReasoning: "Reasoning arrives while the read still runs." })
      expectUser()
      expect(container.querySelector("[data-process-current] [data-running-calls]")?.getAttribute("data-running-calls")).toBe("read")
      expect(container.querySelector("[data-process-shimmer]")).toBeNull()
      render({ liveSegments: [{ ...runningTool, calls: runningTool.calls.map((call) => ({ ...call, status: "completed", output: "File read." })) }], streamingReasoning: "Now checking the result." })
      expect(container.querySelector("[data-process-current]")).toBeNull()
      expect(container.querySelector("[data-process-handoff] [data-running-calls]")?.getAttribute("data-running-calls")).toBe("")
      expect(container.querySelector("[data-process-handoff] [data-tool-active]")?.getAttribute("data-tool-active")).toBe("false")
      expect(container.querySelector("[data-process-shimmer]")?.textContent).toBe("Now checking the result.")
      render({ streaming: "The response starts." })
      expectUser()
      expect(container.querySelector('[data-assistant-content="The response starts."]')).not.toBeNull()
      expect(container.querySelector("[data-process-toggle]")).toBeNull()
    } finally {
      HTMLElement.prototype.animate = originalAnimate
    }
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
    expect(userSurface?.classList.contains("user-message-surface")).toBe(true)
    expect(userSurface?.classList.contains("max-w-[85%]")).toBe(true)
    const column = container.querySelector<HTMLElement>("[data-message-list-content]")!
    expect(column.classList.contains("w-full")).toBe(true)
    expect(column.classList.contains("max-w-full")).toBe(true)
    expect(column.classList.contains("min-w-0")).toBe(true)
    expect(column.classList.contains("max-w-6xl")).toBe(false)

    const assistantSurfaces = container.querySelectorAll<HTMLElement>(
      '[data-message-role="assistant"]',
    )
    expect(assistantSurfaces).toHaveLength(3)
    for (const surface of assistantSurfaces) {
      expect(surface.classList.contains("bg-transparent")).toBe(true)
      expect(surface.classList.contains("bg-muted")).toBe(false)
      expect(surface.classList.contains("text-base")).toBe(true)
      expect(surface.classList.contains("font-normal")).toBe(true)
      expect(surface.classList.contains("flex-1")).toBe(true)
      expect(surface.classList.contains("min-w-0")).toBe(true)
      expect(surface.classList.contains("max-w-[85%]")).toBe(false)
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

describe("MessageList activity grouping", () => {
  it("keeps every visible body outside the folded activity, including completed turns", () => {
    const container = renderMessageList(toolTurn("latest", "2026-09-20T00:00:00Z", "2026-09-20T00:01:05Z"), true)
    const process = container.querySelector<HTMLElement>("[data-process-activity]")!
    const toggle = process.querySelector<HTMLButtonElement>("[data-process-toggle]")!
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    expect(toggle.getAttribute("aria-label")).toBe("处理了 45秒")
    expect(toggle.textContent).toContain("1 次工具调用")
    for (const text of ["latest process", "latest final"]) {
      const body = container.querySelector(`[data-assistant-content="${text}"]`)
      expect(body).not.toBeNull()
      expect(process.contains(body)).toBe(false)
    }
    expect(container.querySelectorAll('[data-reasoning="latest final reasoning"]')).toHaveLength(1)
    expect(process.querySelector('[data-reasoning="latest final reasoning"]')).not.toBeNull()
    act(() => toggle.click())
    expect(process.querySelector("[data-process-content]")?.getAttribute("aria-hidden")).toBe("false")
    expect(process.querySelector("[data-process-content]")?.hasAttribute("inert")).toBe(false)
  })

  it("folds a finished turn's middle behind a divider showing elapsed time and tool count", () => {
    const container = renderMessageList([
      ...toolTurn("folded", "2026-09-20T00:00:00Z", "2026-09-20T00:01:05Z"),
      { id: "next-user", role: "user", content: "next request", createdAt: "2026-09-20T00:02:00Z" },
    ], false)
    const divider = container.querySelector<HTMLElement>("[data-turn-toggle]")!
    expect(divider.getAttribute("aria-expanded")).toBe("false")
    // 00:00:10 (first intermediate body) → 00:00:30 (last tool result) = 20s…
    // …plus the folded reasoning parts up to 00:01:05 recorded on the final
    // message's metadata; the divider reports the full folded middle span.
    expect(divider.getAttribute("aria-label")).toBe("处理了 55秒 · 1 次工具调用")
    // Only the final conclusion stays visible outside the fold.
    expect(container.querySelector('[data-assistant-content="folded process"]')?.closest("[data-turn-collapse]")).not.toBeNull()
    expect(container.querySelector('[data-assistant-content="folded final"]')?.closest("[data-turn-collapse]")).toBeNull()
    // The folded middle is mounted for disclosure but inert until expanded.
    const fold = container.querySelector<HTMLElement>("[data-turn-collapse]")!
    expect(fold.querySelector("[data-process-toggle]")?.getAttribute("aria-expanded")).toBe("false")
    expect(fold.querySelector(".turn-collapse-content")?.hasAttribute("inert")).toBe(true)
    act(() => divider.click())
    expect(divider.getAttribute("aria-expanded")).toBe("true")
    expect(fold.querySelector(".turn-collapse-content")?.hasAttribute("inert")).toBe(false)
    expect(fold.querySelector('[data-assistant-content="folded process"]')).not.toBeNull()
  })

  it("keeps the live tail unfolded while streaming and folds it once the summary is recorded", () => {
    const host = document.createElement("div"); document.body.appendChild(host)
    const root = createRoot(host); mountedRoots.push(root)
    const history = toolTurn("tail", "2026-09-20T00:00:00Z", "2026-09-20T00:01:05Z")
    const props: Parameters<typeof MessageList>[0] = {
      scrollRef: createRef(), contentRef: createRef(), onScroll: vi.fn(),
      messages: history.slice(0, 4), mergedSubAgents: {}, sending: true,
      latestRunFinished: false, streaming: null, streamingActive: true,
      streamingReasoning: null, liveSegments: [], streamStatus: null, pendingUserText: null,
      forking: false, onSelectSubAgent: vi.fn(), onPreviewImage: vi.fn(), onRegenerate: vi.fn(),
      onFork: vi.fn(), onDelete: vi.fn(), onEditMessage: vi.fn(),
    }
    const render = (updates: Partial<typeof props>) => act(() => root.render(<MessageList {...props} {...updates} />))
    render({})
    expect(host.querySelector("[data-turn-toggle]")).toBeNull()
    expect(host.querySelector('[data-assistant-content="tail process"]')).not.toBeNull()
    // The recorded summary finishes the turn; the middle collapses behind the divider.
    render({ messages: history, sending: false, streamingActive: false })
    expect(host.querySelector("[data-turn-toggle]")?.getAttribute("aria-expanded")).toBe("false")
    const fold = host.querySelector<HTMLElement>("[data-turn-collapse]")!
    expect(fold.querySelector('[data-assistant-content="tail process"]')).not.toBeNull()
    expect(host.querySelector('[data-assistant-content="tail final"]')?.closest("[data-turn-collapse]")).toBeNull()
  })

  it("merges tools and reasoning through empty messages and splits only at visible messages", () => {
    const tools = toolTurn("one", "2026-09-20T00:00:00Z", "2026-09-20T00:01:05Z").slice(2, 4)
    const thought = (id: string, content = ""): Message => ({ id, role: "assistant", type: "text", content, metadata: { reasoning: id }, createdAt: "" })
    const container = renderMessageList([
      ...tools, thought("first reasoning"), { id: "empty", role: "assistant", type: "text", content: "", createdAt: "" },
      { id: "system", role: "system", content: "not a visible boundary", createdAt: "" },
      ...toolTurn("two", "", "").slice(2, 4), thought("second reasoning"),
      thought("body reasoning", "Visible progress"), ...toolTurn("three", "", "").slice(2, 4), thought("last reasoning"),
    ], false)
    const groups = container.querySelectorAll("[data-process-activity]")
    expect(groups).toHaveLength(2)
    expect(groups[0]?.querySelectorAll("[data-tool-items]")).toHaveLength(2)
    expect(groups[0]?.querySelectorAll("[data-reasoning]")).toHaveLength(3)
    expect(groups[0]?.querySelector("[data-process-brief]")?.textContent).toBe("body reasoning")
    expect(groups[1]?.querySelector("[data-process-brief]")?.textContent).toBe("last reasoning")
    const body = container.querySelector('[data-assistant-content="Visible progress"]')!
    expect(groups[0]?.contains(body)).toBe(false)
    expect(groups[1]?.contains(body)).toBe(false)
  })

  it("treats image-only messages as visible boundaries", () => {
    const container = renderMessageList([
      ...toolTurn("one", "", "").slice(2, 4),
      { id: "picture", role: "assistant", type: "text", content: "", images: [{ url: "https://example.test/image.png" }], createdAt: "" } as unknown as Message,
      ...toolTurn("two", "", "").slice(2, 4),
    ], false)
    expect(container.querySelectorAll("[data-process-activity]")).toHaveLength(2)
    expect(container.querySelector('[data-message-row="picture"] img')).not.toBeNull()
  })

  it("resizes only the owning activity row when its nested tool group expands", () => {
    const heightSpy = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get")
      .mockImplementation(function (this: HTMLElement) {
        const key = this.dataset.historyEntryKey
        if (key === "message-latest-user") return 52
        if (key === "message-latest-process") return 44
        if (key === "collapsed-turn-latest-final") return this.querySelector('[data-tool-items][aria-expanded="true"]') ? 293 : 25
        if (key === "message-latest-final") return 640
        return 0
      })
    try {
      const container = renderMessageList(toolTurn("latest", "2026-09-20T00:00:00Z", "2026-09-20T00:01:05Z"), false)
      // The finished turn's middle is folded behind its divider; open it first.
      act(() => container.querySelector<HTMLButtonElement>("[data-turn-toggle]")!.click())
      act(() => container.querySelector<HTMLButtonElement>("[data-process-toggle]")!.click())
      const finalRow = container.querySelector<HTMLElement>('[data-history-entry-key="message-latest-final"]')!
      const toolToggle = container.querySelector<HTMLButtonElement>('[data-tool-items="2"]')!
      const initialTop = Number.parseFloat(finalRow.style.transform.match(/[\d.]+/)?.[0] ?? "0")
      act(() => toolToggle.click())
      const expandedTop = Number.parseFloat(finalRow.style.transform.match(/[\d.]+/)?.[0] ?? "0")
      expect(toolToggle.getAttribute("aria-expanded")).toBe("true")
      expect(expandedTop - initialTop).toBe(268)
    } finally { heightSpy.mockRestore() }
  })

  it("keeps earlier activity folded without hiding the newer turn", () => {
    const container = renderMessageList([
      ...toolTurn("earlier", "2026-09-20T00:00:00Z", "2026-09-20T00:01:05Z"),
      { id: "new-user", role: "user", content: "new request", createdAt: "" },
      { id: "new-response", role: "assistant", type: "text", content: "new response", createdAt: "" },
    ], false)
    expect(container.querySelectorAll("[data-process-activity]")).toHaveLength(1)
    expect(container.querySelector("[data-process-toggle]")?.getAttribute("aria-expanded")).toBe("false")
    expect(container.querySelector('[data-assistant-content="earlier process"]')).not.toBeNull()
    expect(container.querySelector('[data-assistant-content="new response"]')).not.toBeNull()
  })
})

describe("subagent transcript provenance", () => {
  const spawn = (id: string, childId: string, compact = false): Message[] => [{
    id, role: "assistant", type: "tool_call", createdAt: "2026-10-16T00:00:00Z",
    toolCalls: [{ toolCallId: id, toolName: "sub_agent", parameters: compact ? { intent: "chat", message: "bounded assignment" } : { action: "create" } }],
  }, {
    id: `${id}-result`, role: "assistant", type: "tool_result", createdAt: "2026-10-16T00:00:01Z",
    toolName: "sub_agent", toolCallId: id, isError: false,
    result: { tool_name: "sub_agent", result: JSON.stringify(compact ? { actor_id: childId } : { child_session_id: childId }), display_preference: "Default" },
  }]
  const user = (id: string): Message => ({ id, role: "user", content: id, createdAt: "2026-10-16T00:00:00Z" })
  it.each([false, true])("keeps each child at its creation group when a newer turn spawns another child (compact=%s)", (compact) => {
    const host = document.createElement("div"); document.body.appendChild(host)
    const root = createRoot(host); mountedRoots.push(root)
    const props: Parameters<typeof MessageList>[0] = {
      scrollRef: createRef(), contentRef: createRef(), onScroll: vi.fn(),
      messages: [user("turn-1"), ...spawn("create-1", "child-1", compact)],
      mergedSubAgents: { "child-1": { status: "running" } }, sending: false,
      latestRunFinished: false, streaming: null, streamingActive: false,
      streamingReasoning: null, liveSegments: [], streamStatus: null, pendingUserText: null,
      forking: false, onSelectSubAgent: vi.fn(), onPreviewImage: vi.fn(), onRegenerate: vi.fn(),
      onFork: vi.fn(), onDelete: vi.fn(), onEditMessage: vi.fn(),
    }
    const render = (updates: Partial<typeof props>) => act(() => root.render(<MessageList {...props} {...updates} />))
    const row = (id: string) => host.querySelector(`[data-subagent-id="${id}"]`)?.closest("[data-history-entry-key]")?.getAttribute("data-history-entry-key")
    render({})
    expect(row("child-1")).toBe("activity-create-1")
    const messages = [...props.messages, user("turn-2"), ...spawn("create-2", "child-2", compact)]
    render({ messages, mergedSubAgents: { "child-2": { status: "running" }, "child-1": { status: "completed" } } })
    expect(row("child-1")).toBe("activity-create-1")
    expect(row("child-2")).toBe("activity-create-2")
    render({ messages: [...messages, user("turn-3"), { id: "tasks", role: "assistant", type: "tool_call",
      createdAt: "", toolCalls: [{ toolCallId: "tasks", toolName: "TaskList", parameters: {} }] }],
      mergedSubAgents: { "child-1": { status: "error" }, "child-2": { status: "cancelled" } } })
    expect(row("child-1")).toBe("activity-create-1")
    expect(row("child-2")).toBe("activity-create-2")
  })
  it("preserves birth placement through the live-to-history handoff and later status updates", () => {
    const host = document.createElement("div"); document.body.appendChild(host)
    const root = createRoot(host); mountedRoots.push(root)
    const props: Parameters<typeof MessageList>[0] = {
      scrollRef: createRef(), contentRef: createRef(), onScroll: vi.fn(), messages: [user("turn-1")],
      mergedSubAgents: { child: { status: "running" } }, sending: true,
      latestRunFinished: false, streaming: null, streamingActive: false,
      streamingReasoning: null, liveSegments: [{ kind: "tools", calls: [{ toolCallId: "live-create", toolName: "sub_agent",
        args: { action: "create" }, status: "completed", output: JSON.stringify({ child_session_id: "child" }) }] },
        { kind: "text", text: "Birth answer", reasoning: null }], streamStatus: null, pendingUserText: null,
      forking: false, onSelectSubAgent: vi.fn(), onPreviewImage: vi.fn(), onRegenerate: vi.fn(),
      onFork: vi.fn(), onDelete: vi.fn(), onEditMessage: vi.fn(),
    }
    const render = (updates: Partial<typeof props>) => act(() => root.render(<MessageList {...props} {...updates} />))
    const card = () => host.querySelector('[data-subagent-id="child"]')!
    render({})
    act(() => card().querySelector<HTMLButtonElement>("button")!.click())
    expect(card().querySelector("button")!.getAttribute("aria-expanded")).toBe("true")
    const answer = host.querySelector('[data-assistant-content="Birth answer"]')!
    expect(card().compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const messages = [user("turn-1"), ...spawn("live-create", "child"), { id: "answer", role: "assistant", type: "text", content: "Birth answer", createdAt: "" } as Message]
    render({ messages, liveSegments: [], sending: false })
    // The completed turn folds its middle (including the spawn process) behind
    // the divider keyed by its final summary message.
    expect(card().closest("[data-history-entry-key]")?.getAttribute("data-history-entry-key")).toBe("collapsed-turn-answer")
    // The process renderer owns its SubAgents group; the fold renders it once.
    expect(host.querySelectorAll('[data-subagent-id="child"]')).toHaveLength(1)
    expect(card().querySelector("button")!.getAttribute("aria-expanded")).toBe("true")
    const persistedCard = card()
    render({ messages: [...messages, user("new-turn")], liveSegments: [], sending: false, mergedSubAgents: { child: { status: "completed" } } })
    expect(card()).toBe(persistedCard)
    expect(card().querySelector("button")!.getAttribute("aria-expanded")).toBe("true")
    act(() => card().querySelector<HTMLButtonElement>("button")!.click())
    render({ messages, liveSegments: [], sending: false, mergedSubAgents: { child: { status: "cancelled" } } })
    expect(card().querySelector("button")!.getAttribute("aria-expanded")).toBe("false")
    expect(card().closest("[data-history-entry-key]")?.getAttribute("data-history-entry-key")).toBe("collapsed-turn-answer")
  })

})


describe("cleared transcript subagent history", () => {
  const systemOnly: Message[] = [
    { id: "retained-system", role: "system", content: "cleared conversation", createdAt: "2026-11-02T00:00:00Z" },
  ]
  const children = { "child-1": { status: "completed" }, "child-2": { status: "error" } }
  const renderCleared = (messages: Message[], agents: Record<string, { status: string; createdAt?: string }>) => {
    const host = document.createElement("div"); document.body.appendChild(host)
    const root = createRoot(host); mountedRoots.push(root)
    const props: Parameters<typeof MessageList>[0] = {
      scrollRef: createRef(), contentRef: createRef(), onScroll: vi.fn(),
      messages, mergedSubAgents: agents, sending: false, latestRunFinished: true,
      streaming: null, streamingActive: false, streamingReasoning: null, liveSegments: [],
      streamStatus: null, pendingUserText: null, forking: false, onSelectSubAgent: vi.fn(),
      onPreviewImage: vi.fn(), onRegenerate: vi.fn(), onFork: vi.fn(), onDelete: vi.fn(), onEditMessage: vi.fn(),
    }
    const render = (updates: Partial<typeof props> = {}) => act(() => root.render(<MessageList {...props} {...updates} />))
    render()
    return { host, render }
  }
  it("folds cleared-transcript children into one collapsed history line that expands to the cards", () => {
    const { host } = renderCleared(systemOnly, children)
    // Collapsed by default: one line, no stacked cards, empty state still visible.
    const entry = host.querySelector<HTMLElement>("[data-cleared-subagents]")
    expect(entry).not.toBeNull()
    expect(host.querySelector("[data-subagent-group]")).toBeNull()
    const toggle = entry!.querySelector<HTMLButtonElement>("[data-cleared-subagents-toggle]")!
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    expect(entry!.querySelector("[data-cleared-subagents-brief]")?.textContent)
      .toBe(uiText("cleared_session_subagents", { count: 2 }))
    expect(host.textContent).toContain(uiText("start_a_new_conversation_bab6ab18"))

    // Expanding reveals the same SubAgents card list (shared renderer, no copy).
    act(() => toggle.click())
    expect(host.querySelector<HTMLButtonElement>("[data-cleared-subagents-toggle]")!.getAttribute("aria-expanded")).toBe("true")
    const group = host.querySelector("[data-subagent-group]")
    expect(group).not.toBeNull()
    expect([...group!.querySelectorAll("[data-subagent-id]")].map((node) => node.getAttribute("data-subagent-id")))
      .toEqual(["child-1", "child-2"])
    expect(host.textContent).toContain(uiText("start_a_new_conversation_bab6ab18"))

    act(() => host.querySelector<HTMLButtonElement>("[data-cleared-subagents-toggle]")!.click())
    expect(host.querySelector("[data-subagent-group]")).toBeNull()
    expect(host.querySelector<HTMLButtonElement>("[data-cleared-subagents-toggle]")!.getAttribute("aria-expanded")).toBe("false")
  })
  it("keeps the cleared fold off an empty transcript without children", () => {
    const { host } = renderCleared([], {})
    expect(host.querySelector("[data-cleared-subagents]")).toBeNull()
    expect(host.querySelector("[data-subagent-group]")).toBeNull()
    expect(host.textContent).toContain(uiText("start_a_new_conversation_bab6ab18"))
  })
  it("keeps unplaced cards born within the retained transcript directly visible", () => {
    const createdAt = "2026-11-02T00:00:01Z"
    const { host } = renderCleared([
      { id: "user-1", role: "user", content: "question", createdAt: "2026-11-02T00:00:00Z" },
      { id: "assistant-1", role: "assistant", type: "text", content: "answer", createdAt: "2026-11-02T00:00:01Z" },
    ], { "child-1": { ...children["child-1"], createdAt }, "child-2": { ...children["child-2"], createdAt } })
    expect(host.querySelector("[data-cleared-subagents]")).toBeNull()
    const group = host.querySelector("[data-subagent-group]")
    expect(group).not.toBeNull()
    expect([...group!.querySelectorAll("[data-subagent-id]")].map((node) => node.getAttribute("data-subagent-id")))
      .toEqual(["child-1", "child-2"])
    expect(host.textContent).not.toContain(uiText("start_a_new_conversation_bab6ab18"))
  })

  it("keeps earlier children folded during send, after readback, and on a fresh mount", () => {
    const old = { status: "completed", createdAt: "2026-11-02T00:00:01.000100Z" }
    const fresh = { status: "running", createdAt: "2026-11-02T00:00:03Z" }
    const messages: Message[] = [...systemOnly,
      { id: "new-turn", role: "user", content: "New conversation", createdAt: "2026-11-02T00:00:01.000900Z" }]
    const { host, render } = renderCleared(systemOnly, { old })
    const folded = (container: HTMLElement) => {
      expect(container.querySelector("[data-cleared-subagents-toggle]")?.getAttribute("aria-expanded")).toBe("false")
      expect(container.querySelector('[data-subagent-id="old"]')).toBeNull()
    }
    render({ pendingUserText: "New conversation", sending: true })
    folded(host)
    render({ messages, mergedSubAgents: { old, fresh }, sending: true })
    folded(host)
    expect(host.querySelector('[data-subagent-id="fresh"]')).not.toBeNull()

    const { host: reopened, render: hydrate } = renderCleared(messages, { old: { status: old.status }, fresh })
    folded(reopened)
    expect(reopened.querySelector("[data-cleared-subagents-brief]")?.textContent).toBe(`${uiText("subagents_76d97a95")}1)`)
    hydrate({ mergedSubAgents: { old, fresh } })
    folded(reopened)
    expect(reopened.querySelector("[data-cleared-subagents-brief]")?.textContent).toBe(uiText("cleared_session_subagents", { count: 1 }))
    act(() => reopened.querySelector<HTMLButtonElement>("[data-cleared-subagents-toggle]")!.click())
    expect(reopened.querySelector('[data-cleared-subagents] [data-subagent-id="old"]')).not.toBeNull()
    expect(reopened.querySelector('[data-cleared-subagents] [data-subagent-id="fresh"]')).toBeNull()
  })
})


describe("image attachment visibility", () => {
  it("renders each retained acknowledgement as its own image bubble and preview", () => {
    const image = (name: string) => ({ id: name, url: `data:image/png;base64,${name}`, name, size: 1, type: "image/png" })
    const first = image("first"), second = image("second"), preview = vi.fn()
    const host = renderMessageList([], false, { text: "second caption", images: [second], preview, messages: [
      { operationId: 1, text: "first caption", images: [first] },
      { operationId: 2, text: "second caption", images: [second] },
    ] })
    const bubbles = host.querySelectorAll("[data-pending-user-message]")
    expect([...bubbles].map((node) => node.textContent)).toEqual(["first caption", "second caption"])
    expect([...bubbles].map((node) => node.getAttribute("data-pending-operation"))).toEqual(["1", "2"])
    act(() => bubbles[0].querySelector("img")!.click())
    act(() => bubbles[1].querySelector("img")!.click())
    expect(preview.mock.calls).toEqual([[first.url], [second.url]])
  })
  it("an authoritative empty pending list cannot fall back to a retired legacy bubble", () => {
    const host = renderMessageList([], false, { text: "retired ACK", images: [], messages: [] })
    expect(host.querySelector("[data-pending-user-message]")).toBeNull()
  })
  it.each(["", "caption with image"])("renders and previews a pending image without hiding an image-only bubble (%s)", (text) => {
    const url = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", preview = vi.fn()
    const host = renderMessageList([], false, { text, preview,
      images: [{ id: "pending-image", url, name: "fixture.gif", type: "image/gif", size: 42 }] })
    const bubble = host.querySelector("[data-pending-user-message]")
    const image = bubble?.querySelector("img")
    expect(image?.getAttribute("src")).toBe(url)
    expect(bubble?.textContent).toBe(text)
    act(() => image!.click()); expect(preview).toHaveBeenCalledWith(url)
  })
})


it("restores a persisted image-only user message through the existing full history contract", () => {
  const messages = mapHistoryMessagesToUi("fixture", [{ id: "persisted-image-only", role: "user", content: "",
    content_parts: [{ type: "image_url", image_url: { url: "bamboo-attachment://fixture/asset-1" } }],
    created_at: "2026-10-19T00:00:00Z" }])
  const host = renderMessageList(messages, true)
  expect(host.querySelector('[data-message-row="persisted-image-only"] img')?.getAttribute("src"))
    .toBe(apiClient.resolveUrl("sessions/fixture/attachments/asset-1"))
  expect(host.querySelector("[data-pending-user-message]")).toBeNull()
})
