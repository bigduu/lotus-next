import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  useChat: vi.fn((_sessionId?: string | null, _onCreated?: (id: string) => void) => ({})),
  loadChatHistory: vi.fn(async (_id: string) => {}),
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
  expect(mocks.loadChatHistory).toHaveBeenCalledWith("root-1")
  expect(mocks.safePane).not.toHaveBeenCalled()
  expect(mocks.chatPane.mock.lastCall?.[0].secondary).toMatchObject({
    sessionId: "root-1", onPickSession, chats,
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
  expect(mocks.loadChatHistory).toHaveBeenCalledWith("root-2")
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
