import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  useChat: vi.fn((_sessionId?: string | null, _onCreated?: (id: string) => void) => ({})),
  loadChatHistory: vi.fn(async (_id: string, _options?: { throwOnError?: boolean; signal?: AbortSignal }) => {}),
  chatPane: vi.fn(),
  safePane: vi.fn(),
}))

vi.mock("@/hooks/useChat", () => ({ useChat: mocks.useChat }))
vi.mock("@shared/store/appStore", () => ({
  useAppStore: { getState: () => ({ loadChatHistory: mocks.loadChatHistory }) },
}))
vi.mock("@/components/app/ChatPane", () => ({
  ChatPane: (props: Record<string, unknown>) => {
    mocks.chatPane(props)
    return <div data-interactive-pane />
  },
}))
vi.mock("@/components/app/SubagentTranscriptPane", () => ({
  SubagentTranscriptPane: (props: Record<string, unknown>) => {
    mocks.safePane(props)
    return <div data-projected-pane />
  },
}))

import { SecondarySessionPane } from "./SecondarySessionPane"
import type { ChatItem } from "@shared/types/chat"

const chat = (id: string, kind: "root" | "child", parentSessionId?: string): ChatItem => ({
  id,
  kind,
  parentSessionId,
  title: id,
  createdAt: 0,
  messages: [],
  config: { systemPromptId: "", baseSystemPrompt: "", lastUsedEnhancedPrompt: null },
})

const chats = [chat("root-1", "root"), chat("root-2", "root"), chat("child-1", "child", "root-1")]
let root: Root | null = null
let container: HTMLDivElement | null = null
const onPickSession = vi.fn()
const props = { chats, onPickSession, onClose: vi.fn(), onOpenInspector: vi.fn(), onOpenReview: vi.fn() }

async function render(sessionId: string | null, options: typeof props & { active?: boolean } = props) {
  await act(async () => {
    root?.render(<SecondarySessionPane {...options} sessionId={sessionId} />)
    await Promise.resolve()
  })
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  mocks.loadChatHistory.mockReset().mockResolvedValue(undefined)
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

it("retains the interactive pane for roots and loads their generic history", async () => {
  await render("root-1")
  expect(container?.querySelector("[data-interactive-pane]")).not.toBeNull()
  expect(mocks.useChat).toHaveBeenCalledWith("root-1", expect.any(Function))
  expect(mocks.loadChatHistory).toHaveBeenCalledWith("root-1", { throwOnError: true, signal: expect.any(AbortSignal) })
  expect(mocks.safePane).not.toHaveBeenCalled()
  expect(mocks.chatPane.mock.lastCall?.[0].secondary).toMatchObject({
    sessionId: "root-1", onPickSession: expect.any(Function), chats,
  })

  // An unbound split pane must also stay interactive, as before.
  await render(null)
  expect(mocks.useChat).toHaveBeenCalledWith(null, expect.any(Function))
  expect(mocks.loadChatHistory).toHaveBeenCalledTimes(1)
})

it("unmounts full chat when switching to children or unknown IDs, then restores root mode", async () => {
  await render("root-1")
  const rootHookCalls = mocks.useChat.mock.calls.length
  await render("child-1")
  expect(container?.querySelector("[data-interactive-pane]")).toBeNull()
  expect(container?.querySelector("[data-projected-pane]")).not.toBeNull()
  expect(mocks.safePane.mock.lastCall?.[0]).toMatchObject({ sessionId: "child-1", onPickSession })
  expect(mocks.useChat).toHaveBeenCalledTimes(rootHookCalls)
  expect(mocks.loadChatHistory).toHaveBeenCalledTimes(1)

  await render("not-in-index")
  expect(mocks.useChat).toHaveBeenCalledTimes(rootHookCalls)
  expect(mocks.loadChatHistory).toHaveBeenCalledTimes(1)

  await render("root-2")
  expect(container?.querySelector("[data-interactive-pane]")).not.toBeNull()
  expect(mocks.useChat).toHaveBeenCalledWith("root-2", expect.any(Function))
  expect(mocks.loadChatHistory).toHaveBeenCalledWith("root-2", { throwOnError: true, signal: expect.any(AbortSignal) })
})

it("waits for a verified root before upgrading a missing session to interactive mode", async () => {
  await render("late-root")
  expect(mocks.useChat).not.toHaveBeenCalled()
  await render("late-root", { ...props, chats: [...chats, chat("late-root", "root")] })
  expect(mocks.useChat).toHaveBeenCalledWith("late-root", expect.any(Function))
})

it("keeps a newly acknowledged root interactive before its index entry arrives", async () => {
  await render(null)
  const onCreated = mocks.useChat.mock.lastCall?.[1] as (id: string) => void
  act(() => onCreated("fresh-root"))
  expect(onPickSession).toHaveBeenCalledWith("fresh-root")
  await render("fresh-root")
  expect(container?.querySelector("[data-interactive-pane]")).not.toBeNull()
  expect(mocks.useChat).toHaveBeenCalledWith("fresh-root", expect.any(Function))

  // Even the locally trusted id must yield if the server reports a child.
  await render("fresh-root", { ...props, chats: [...chats, chat("fresh-root", "child", "root-1")] })
  expect(container?.querySelector("[data-interactive-pane]")).toBeNull()
  expect(container?.querySelector("[data-projected-pane]")).not.toBeNull()
})

it("keeps root chat mounted but suspends child projection on other workbench tabs", async () => {
  await render("root-1", { ...props, active: false })
  expect(container?.querySelector("[data-interactive-pane]")).not.toBeNull()
  await render("child-1", { ...props, active: false })
  expect(container?.querySelector("[data-projected-pane]")).toBeNull()
  expect(mocks.useChat).not.toHaveBeenCalledWith("child-1", expect.any(Function))
  await render("child-1", { ...props, active: true })
  expect(container?.querySelector("[data-projected-pane]")).not.toBeNull()
})

it("allows a root drop to replace a projected child without selecting the main session", async () => {
  await render("child-1")
  const event = new Event("drop", { bubbles: true, cancelable: true })
  Object.defineProperty(event, "dataTransfer", { value: { types: ["application/x-lotus-sidebar-session"], getData: () => JSON.stringify({ sessionId: "root-2", projectId: null }) } })
  act(() => container!.querySelector("[data-projected-pane]")!.dispatchEvent(event))
  expect(onPickSession).toHaveBeenCalledExactlyOnceWith("root-2")
  expect(mocks.useChat).not.toHaveBeenCalled()
})


it("surfaces failed reads and retries the same session explicitly", async () => {
  mocks.loadChatHistory.mockRejectedValueOnce(new Error("503")).mockResolvedValueOnce(undefined)
  await render("root-1")
  expect(mocks.chatPane.mock.lastCall?.[0].secondary.historyRead.status).toBe("error")
  expect(mocks.loadChatHistory).toHaveBeenCalledTimes(1)
  await act(async () => mocks.chatPane.mock.lastCall?.[0].secondary.historyRead.retry())
  expect(mocks.loadChatHistory).toHaveBeenCalledTimes(2)
  expect(mocks.loadChatHistory.mock.lastCall?.[0]).toBe("root-1")
  expect(mocks.chatPane.mock.lastCall?.[0].secondary.historyRead.status).toBe("ready")
  expect(onPickSession).not.toHaveBeenCalled()
})

it("fences an abandoned session read and clears failure when entering a new draft", async () => {
  let reject!: (error: Error) => void
  mocks.loadChatHistory.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
  await render("root-1")
  const signal = mocks.loadChatHistory.mock.calls[0][1]?.signal
  expect(mocks.chatPane.mock.lastCall?.[0].secondary.historyRead.status).toBe("loading")
  await render("root-2")
  expect(signal?.aborted).toBe(true)
  await act(async () => reject(new Error("late 503")))
  expect(mocks.chatPane.mock.lastCall?.[0].secondary.historyRead.status).toBe("ready")
  await render(null)
  expect(mocks.chatPane.mock.lastCall?.[0].secondary.historyRead.status).toBe("ready")
})

it("allows reselecting a failed session to retry and aborts on close", async () => {
  mocks.loadChatHistory.mockRejectedValue(new Error("503"))
  await render("root-1")
  await act(async () => mocks.chatPane.mock.lastCall?.[0].secondary.onPickSession("root-1"))
  expect(mocks.loadChatHistory).toHaveBeenCalledTimes(2)
  const signal = mocks.loadChatHistory.mock.lastCall?.[1]?.signal
  act(() => root?.unmount())
  root = null
  expect(signal?.aborted).toBe(true)
})
