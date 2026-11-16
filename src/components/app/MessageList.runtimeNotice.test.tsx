import { act, createRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, beforeAll, afterAll, vi } from "vitest"

// Same i18n + clipboard isolation as MessageList.test.tsx (see its header for
// the rationale): pin a locale before importing components that read catalogs.
const i18nModule = await vi.importActual<typeof import("@shared/i18n")>("@shared/i18n")
const i18n = i18nModule.default
beforeAll(async () => {
  await i18n.changeLanguage("zh-CN")
})
afterAll(async () => {
  await i18n.changeLanguage("en-US")
})

const clipboard = vi.hoisted(() => ({ copyText: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/clipboard", () => ({ copyText: clipboard.copyText }))
vi.mock("@/components/chat/LazyAssistantMarkdown", () => ({ LazyAssistantMarkdown: ({ children }: { children: React.ReactNode }) => (
  <div data-testid="assistant-markdown">{children}</div>
) }))
vi.mock("@/components/chat/StreamdownMarkdown", () => ({ StreamdownMarkdown: ({ children }: { children: React.ReactNode }) => (
  <div data-testid="streamdown-markdown">{children}</div>
) }))

import { MessageList } from "./MessageList"
import { mapHistoryMessagesToUi } from "@shared/store/appStore/slices/chatSessionSlice/messageMapping"
import { uiText } from "@shared/i18n/ui"
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
  clipboard.copyText.mockReset()
  vi.useRealTimers()
})

// Frozen producer notice (Bamboo pipeline.rs) — the shape history serves.
const noticeHistoryMessage = {
  id: "runtime-wait-notice",
  role: "assistant" as const,
  phase: "final_answer" as const,
  content: "Moved command `e9511561-7f99-4389-a7de-0c9e7a39ffe7` to background monitoring. You can continue this conversation; its result will return automatically.",
  created_at: "2026-10-30T16:00:00Z",
  metadata: {
    runtime_kind: "background_exec_wait",
    source: "runtime",
    exec_session_id: "e9511561-7f99-4389-a7de-0c9e7a39ffe7",
  },
}

const progressHistory = [
  { id: "build-user", role: "user" as const, content: "Build and check the artifact.", created_at: "2026-10-30T15:59:00Z" },
  {
    id: "build-progress", role: "assistant" as const, phase: "commentary" as const,
    content: "The build has started.", created_at: "2026-10-30T15:59:10Z",
  },
  {
    id: "read-command", role: "assistant" as const, content: "", created_at: "2026-10-30T15:59:20Z",
    tool_calls: [{ id: "read-output", type: "function", function: { name: "write_stdin", arguments: "{}" } }],
  },
  {
    id: "read-result", role: "tool" as const, tool_call_id: "read-output",
    content: "running", created_at: "2026-10-30T15:59:21Z",
  },
]

function renderMessageList(messages: Message[], liveSegments: LiveSegment[] = [], backgroundExecWaiting = false) {
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
        sending={backgroundExecWaiting || liveSegments.length > 0}
        latestRunFinished={false}
        streaming={null}
        streamingActive={false}
        streamingReasoning={null}
        liveSegments={liveSegments}
        streamStatus={null}
        backgroundExecWaiting={backgroundExecWaiting}
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

describe("runtime background-exec wait notices", () => {
  it("maps backend notice metadata through history loading", () => {
    const messages = mapHistoryMessagesToUi("runtime-notice-session", [
      { id: "prior-user", role: "user" as const, content: "请求执行长命令", created_at: "2026-10-30T15:59:00Z" },
      noticeHistoryMessage,
    ])
    const notice = messages.find((m) => m.id === "runtime-wait-notice")
    expect(notice).toBeDefined()
    expect((notice as { metadata?: Record<string, unknown> }).metadata?.runtime_kind).toBe("background_exec_wait")
    expect((notice as { metadata?: Record<string, unknown> }).metadata?.exec_session_id).toBe("e9511561-7f99-4389-a7de-0c9e7a39ffe7")
  })

  it("renders the notice as a localized card, not the raw English text", () => {
    const messages = mapHistoryMessagesToUi("runtime-notice-session", [noticeHistoryMessage])
    const container = renderMessageList(messages)
    const card = container.querySelector('[data-runtime-notice="background_exec_wait"]')
    expect(card).not.toBeNull()
    expect(card?.textContent).toContain(uiText("runtime_notice_background_exec_title_1b8a7ef0"))
    expect(card?.textContent).toContain("e9511561-7f99-4389-a7de-0c9e7a39ffe7")
    // The raw English machine text must not leak into the transcript.
    expect(container.textContent).not.toContain("Moved command")
    expect(container.textContent).not.toContain("background monitoring")
  })

  it("falls back to the frozen producer prefix when metadata is stripped", () => {
    const stripped = { ...noticeHistoryMessage, metadata: undefined }
    const messages = mapHistoryMessagesToUi("runtime-notice-session", [stripped])
    const container = renderMessageList(messages)
    const card = container.querySelector('[data-runtime-notice="background_exec_wait"]')
    expect(card).not.toBeNull()
    expect(container.textContent).not.toContain("Moved command")
  })

  it("shows the waiting hint while the chat pane confirms an active background wait", () => {
    const messages = mapHistoryMessagesToUi("runtime-notice-session", [noticeHistoryMessage])
    const container = renderMessageList(messages, [], true)
    expect(container.textContent).toContain(uiText("runtime_notice_background_exec_running_93d0e2c1"))
  })

  it("suppresses the waiting hint when execution has ended, even if the notice stays latest", () => {
    // A cancelled/errored run refreshes summary + history without appending a
    // transcript message, so the wait notice can remain the latest message.
    // The execution-gated prop must keep the spinner hidden in that state.
    const messages = mapHistoryMessagesToUi("runtime-notice-session", [noticeHistoryMessage])
    const container = renderMessageList(messages, [], false)
    expect(container.textContent).not.toContain(uiText("runtime_notice_background_exec_running_93d0e2c1"))
  })

  it("hides the waiting hint once the transcript grows past the notice", () => {
    const messages = mapHistoryMessagesToUi("runtime-notice-session", [
      noticeHistoryMessage,
      { id: "post-completion", role: "assistant" as const, content: "命令完成，结果如下。", created_at: "2026-10-30T16:05:00Z" },
    ])
    const container = renderMessageList(messages)
    expect(container.textContent).not.toContain(uiText("runtime_notice_background_exec_running_93d0e2c1"))
    // The earlier notice still renders as a card.
    expect(container.querySelector('[data-runtime-notice="background_exec_wait"]')).not.toBeNull()
  })

  it("keeps progress in the transcript while a background notice marked final is active", () => {
    const messages = mapHistoryMessagesToUi("runtime-notice-session", [...progressHistory, noticeHistoryMessage])
    const container = renderMessageList(messages, [], true)

    expect(container.querySelector("[data-turn-collapse]")).toBeNull()
    expect(container.querySelector('[data-message-row="build-progress"]')?.textContent).toContain("The build has started.")
    expect(container.textContent).toContain(uiText("runtime_notice_background_exec_running_93d0e2c1"))
  })

  it("keeps progress visible when history restores an unphased background notice", () => {
    const messages = mapHistoryMessagesToUi("runtime-notice-session", [
      ...progressHistory,
      { ...noticeHistoryMessage, phase: undefined },
    ])
    const container = renderMessageList(messages)

    expect(container.querySelector("[data-turn-collapse]")).toBeNull()
    expect(container.querySelector('[data-message-row="build-progress"]')?.textContent).toContain("The build has started.")
  })

  it("keeps previous progress visible after an interjection when only the notice text was retained", () => {
    const messages = mapHistoryMessagesToUi("runtime-notice-session", [
      ...progressHistory,
      { ...noticeHistoryMessage, phase: undefined, metadata: undefined },
      { id: "interjection", role: "user" as const, content: "What are you waiting for?", created_at: "2026-10-30T16:01:00Z" },
    ])
    const container = renderMessageList(messages)

    expect(container.querySelector("[data-turn-collapse]")).toBeNull()
    expect(container.querySelector('[data-message-row="build-progress"]')?.textContent).toContain("The build has started.")
    expect(container.querySelector('[data-message-row="interjection"]')?.textContent).toContain("What are you waiting for?")
  })

  it("folds the process once the recorded final answer arrives", () => {
    const messages = mapHistoryMessagesToUi("runtime-notice-session", [
      ...progressHistory,
      noticeHistoryMessage,
      {
        id: "build-final", role: "assistant" as const, phase: "final_answer" as const,
        content: "The artifact passed verification.", created_at: "2026-10-30T16:05:00Z",
      },
    ])
    const container = renderMessageList(messages)
    const fold = container.querySelector('[data-turn-collapse="collapsed-turn-build-final"]')

    expect(container.querySelectorAll("[data-turn-collapse]")).toHaveLength(1)
    expect(fold?.querySelector('[data-message-row="build-progress"]')?.textContent).toContain("The build has started.")
    expect(fold?.querySelector("[data-turn-toggle]")?.getAttribute("aria-expanded")).toBe("false")
    const final = container.querySelector('[data-message-row="build-final"]')
    expect(final?.textContent).toContain("The artifact passed verification.")
    expect(final?.closest("[data-turn-collapse]")).toBeNull()
  })
})
