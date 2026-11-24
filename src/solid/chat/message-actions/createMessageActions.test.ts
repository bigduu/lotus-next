import { createRoot, flush } from "solid-js"
import { expect, it, vi } from "vitest"
import { uiText } from "@shared/i18n/text"
import { appStore } from "@shared/store/appStore/state"
import type { UserMessage } from "@shared/types/chatMessages"
import type { createChat } from "../createChat"
import { buildHistoryEntries, buildRenderItems } from "../history/historyProjection"
import { createMessageActions } from "./createMessageActions"

it("clears fork progress after a callback rejects and retains the failure details", async () => {
  const origin = "notification-fork-origin"
  const message: UserMessage = { id: "notification-fork-message", role: "user", content: "Fork this draft", createdAt: "2026-11-23T00:00:00Z" }
  const [entry] = buildHistoryEntries(buildRenderItems([message]))
  const previous = appStore.getState().currentSessionId
  const onNotice = vi.fn()
  const onForking = vi.fn()
  let reject!: (reason: Error) => void
  const pending = new Promise<string>((_resolve, fail) => { reject = fail })
  const fork = vi.fn(() => pending)
  type Chat = ReturnType<typeof createChat>
  const ports: Partial<Chat> = {
    currentSessionId: origin, messages: [message], fork,
    executionCompatibility: { blocked: false, observed: true, loading: false, legacy: false, readError: false,
      report: null, refresh: async () => {} },
  }
  appStore.setState({ currentSessionId: origin })
  const { dispose, controller } = createRoot((cleanup) => {
    const controller = createMessageActions({
      chat: ports as Chat, entries: () => [entry], viewport: () => null, rootAuthority: () => undefined,
      onNotice: () => onNotice, onForking: () => onForking,
    })
    return { dispose: cleanup, controller }
  })
  try {
    flush()
    controller.fork(controller.target(entry.key)!)
    expect(fork).toHaveBeenCalledExactlyOnceWith(message.id, expect.objectContaining({ isOriginCurrent: expect.any(Function) }))
    expect(onForking.mock.calls).toEqual([[true]])
    reject(new Error("fork unavailable"))
    await pending.catch(() => undefined)
    flush()
    expect(onForking.mock.calls).toEqual([[true], [false]])
    expect(onNotice).toHaveBeenCalledExactlyOnceWith({
      text: uiText("operation_failed_0c3b4cf7"), error: true, details: "fork unavailable",
    })
  } finally {
    dispose()
    appStore.setState({ currentSessionId: previous })
  }
})
