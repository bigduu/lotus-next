import { describe, expect, it, vi } from "vitest"
import { agentClient } from "@services/chat/AgentService"
import { appStore, initializeStore } from "@shared/store/appStore/state"
import { settleChat } from "./chatInteractionTestHarness"
import { deferred, feedMessages, feedSessions, history, session, useChatStreamFixture, user } from "./chatStreamTestHarness"

vi.mock("@shared/store/appStore/state", async (original) => ({
  ...await original<typeof import("@shared/store/appStore/state")>(),
  initializeStore: vi.fn(async () => {}),
}))

const mount = useChatStreamFixture()
const lastSessionKey = "lotus_next_last_session"

describe("Solid chat session binding", () => {
  it("restores a persisted child before allowing the default root to be persisted", async () => {
    localStorage.setItem(lastSessionKey, "saved-child")
    const lookup = deferred<void>()
    vi.mocked(initializeStore).mockImplementationOnce(async () => {
      feedSessions([session("default-root")])
      appStore.setState({ currentSessionId: "default-root" })
    })
    const restore = vi.spyOn(appStore.getState(), "restoreSession").mockImplementationOnce(async (id) => {
      await lookup.promise
      feedSessions([...appStore.getState().chats, { ...session(id), kind: "child", rootSessionId: "default-root" }])
      return true
    })
    const select = vi.spyOn(appStore.getState(), "selectSession")

    const { chat } = await mount()
    expect(restore).toHaveBeenCalledExactlyOnceWith("saved-child")
    expect(chat.booted).toBe(false)
    expect(localStorage.getItem(lastSessionKey)).toBe("saved-child")
    await settleChat(() => lookup.resolve())
    expect(select).toHaveBeenCalledExactlyOnceWith("saved-child")
    expect(history()).toHaveBeenCalledWith("saved-child")
    expect(chat.currentSessionId).toBe("saved-child")
    expect(chat.booted).toBe(true)
    expect(localStorage.getItem(lastSessionKey)).toBe("saved-child")
  })

  it("force-refreshes a bound pane tree when the root index advances without navigation", async () => {
    feedSessions([session("split-root")])
    await mount("split-root")
    const loadTree = vi.mocked(appStore.getState().loadSubagentSessions)
    expect(loadTree).toHaveBeenCalledExactlyOnceWith("split-root", { force: true })
    loadTree.mockClear()
    await settleChat(() => appStore.setState((state) => ({ sessionIndexRevision: state.sessionIndexRevision + 1 })))
    expect(loadTree).toHaveBeenCalledExactlyOnceWith("split-root", { force: true })
  })

  it("hydrates admitted guidance from the live stream in a bound pane", async () => {
    const id = "split-guidance"
    feedSessions([{ ...session(id), isRunning: true }])
    appStore.getState().markForceSubscribe(id)
    const { chat } = await mount(id)
    expect(agentClient.subscribeToEvents).toHaveBeenCalledTimes(1)
    const onMessageAppended = vi.mocked(agentClient.subscribeToEvents).mock.calls[0][1].onMessageAppended
    expect(onMessageAppended).toBeTypeOf("function")

    await settleChat(() => onMessageAppended?.("different-session", "other-user", true))
    expect(history()).not.toHaveBeenCalled()
    const admitted = user("queued-user", "Use the updated location")
    await settleChat(() => onMessageAppended?.(id, admitted.id, true, admitted))
    expect(history()).toHaveBeenCalledExactlyOnceWith(id, { mode: "monotonic" })
    expect(chat.liveSegments).toEqual([{ kind: "interjection", messageId: admitted.id, message: admitted }])

    await settleChat(() => onMessageAppended?.(id, admitted.id, true, admitted))
    expect(chat.liveSegments).toHaveLength(1)

    await settleChat(() => feedMessages(id, [user("earlier-user", admitted.content)]))
    expect(chat.liveSegments).toHaveLength(1)
    await settleChat(() => feedMessages(id, [...chat.messages, admitted]))
    expect(chat.liveSegments).toEqual([])
    expect(chat.messages).toContainEqual(admitted)
    expect(agentClient.execute).not.toHaveBeenCalled()
  })
})
