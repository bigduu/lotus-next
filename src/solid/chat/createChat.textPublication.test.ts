import { createSignal } from "solid-js"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { agentClient } from "@services/chat/AgentService"
import { appStore } from "@shared/store/appStore/state"
import { settleChat } from "./chatInteractionTestHarness"
import { deferred, feedSessions, history as readHistory, queueStream, session, useChatStreamFixture,
  type Chat } from "./chatStreamTestHarness"

vi.mock("@shared/store/appStore/state", async (original) => ({
  ...await original<typeof import("@shared/store/appStore/state")>(),
  initializeStore: vi.fn(async () => {}),
}))

const mount = useChatStreamFixture()
const sessionId = "batched-answer"
const nextSession = "next-batched-answer"

const send = (chat: Chat, text: string) => settleChat(async () => {
  await expect(chat.send(text)).resolves.toMatchObject({ kind: "accepted" })
})

async function start() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance"] })
  appStore.setState({ currentSessionId: sessionId })
  feedSessions([session(sessionId), session(nextSession)])
  const stream = queueStream(sessionId, null)
  const [pageVisible, setVisible] = createSignal(true)
  const { chat } = await mount(undefined, { pageVisible })
  await send(chat, "stream a long reply")
  return { chat, handlers: stream.handlers, setVisible }
}

const nextFrame = () => settleChat(() => vi.advanceTimersToNextFrame())
const advance = (ms: number) => settleChat(() => vi.advanceTimersByTimeAsync(ms))

beforeEach(() => {
  vi.spyOn(appStore.getState(), "reconcileOpenSession").mockImplementation(() => {})
})

describe("Solid assistant text publication", () => {
  it("displays the first visible text on the next frame and coalesces later chunks to the original deadline", async () => {
    const { chat, handlers } = await start()
    handlers.onToken("  ")
    await nextFrame()
    handlers.onToken("First")
    await nextFrame()
    expect(chat.streaming).toBe("  First")

    handlers.onToken(" second")
    await advance(45)
    handlers.onToken(" third")
    await advance(54)
    expect(chat.streaming).toBe("  First")
    await advance(1)
    expect(chat.streaming).toBe("  First second third")

    await advance(150)
    handlers.onToken(" after a pause")
    await nextFrame()
    expect(chat.streaming).toBe("  First second third after a pause")
  })

  it("moves every buffered character before the tool and shows the next round on its first frame", async () => {
    const { chat, handlers } = await start()
    handlers.onToken("Before")
    await nextFrame()
    await settleChat(() => {
      handlers.onToken(" the tool")
      handlers.onToolStart("batched-tool", "Read", {})
    })
    await nextFrame()
    expect(chat.liveSegments).toMatchObject([
      { kind: "text", text: "Before the tool" },
      { kind: "tools", calls: [{ toolCallId: "batched-tool", status: "running" }] },
    ])
    expect(chat.streaming).toBe("")

    await settleChat(() => {
      handlers.onToolComplete("batched-tool", { success: true, result: "Read completed" })
      handlers.onToken("After the tool")
    })
    await nextFrame()
    expect(chat.streaming).toBe("After the tool")
  })

  it("pauses pending preview updates while covered and restores the ordered timeline in one frame", async () => {
    const { chat, handlers, setVisible } = await start()
    handlers.onToken("Before")
    await nextFrame()
    handlers.onToken(" the tool")
    await settleChat(() => setVisible(false))
    await settleChat(() => {
      handlers.onReasoningToken("Planning the read")
      handlers.onToolStart("hidden-tool", "Read", {})
      handlers.onToolComplete("hidden-tool", { success: true, result: "Read completed" })
      handlers.onReasoningToken("Preparing the answer")
      handlers.onToken("First paragraph\n\nSecond paragraph")
    })
    await advance(200)
    expect(chat.streaming).toBe("Before")
    expect(chat.streamingReasoning).toBeNull()
    expect(chat.liveSegments).toEqual([])

    await settleChat(() => setVisible(true))
    handlers.onToken("\n\nThird paragraph")
    expect(chat.streaming).toBe("Before")
    await nextFrame()
    expect(chat.liveSegments).toMatchObject([
      { kind: "text", text: "Before the tool", reasoning: "Planning the read" },
      { kind: "tools", calls: [{ toolCallId: "hidden-tool", status: "completed", output: "Read completed" }] },
    ])
    expect(chat.streamingReasoning).toBe("Preparing the answer")
    expect(chat.streaming).toBe("First paragraph\n\nSecond paragraph\n\nThird paragraph")
  })

  it("waits for both the document and the pane to show and keeps the terminal tail across that frame", async () => {
    let visibility: DocumentVisibilityState = "visible"
    const hidden = vi.spyOn(document, "hidden", "get").mockImplementation(() => visibility === "hidden")
    const visibilityState = vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility)
    const { chat, handlers, setVisible } = await start()
    handlers.onToken("Beginning")
    await nextFrame()
    await settleChat(() => setVisible(false))
    await settleChat(() => {
      visibility = "hidden"
      document.dispatchEvent(new Event("visibilitychange"))
      handlers.onToken(" and the buffered ending")
    })
    await settleChat(() => setVisible(true))
    await advance(200)
    expect(chat.streaming).toBe("Beginning")

    const history = deferred<void>()
    readHistory().mockReturnValueOnce(history.promise)
    await settleChat(() => {
      visibility = "visible"
      document.dispatchEvent(new Event("visibilitychange"))
      handlers.onComplete(undefined)
    })
    expect(chat.streamPhase).toBe("finalizing")
    expect(chat.streaming).toBe("Beginning and the buffered ending")
    await nextFrame()
    expect(chat.streaming).toBe("Beginning and the buffered ending")
    await settleChat(() => history.resolve())
    expect(appStore.getState().reconcileOpenSession).toHaveBeenCalledExactlyOnceWith(sessionId, "visibility_regain")
    hidden.mockRestore()
    visibilityState.mockRestore()
  })

  it("publishes a buffered terminal tail while persisted history is still pending", async () => {
    const { chat, handlers } = await start()
    handlers.onToken("Beginning")
    await nextFrame()
    const history = deferred<void>()
    readHistory().mockReturnValueOnce(history.promise)
    await settleChat(() => {
      handlers.onToken(" and the terminal tail")
      handlers.onComplete(undefined)
    })
    expect(chat.streamPhase).toBe("finalizing")
    expect(chat.streaming).toBe("Beginning and the terminal tail")
    await advance(100)
    expect(chat.streaming).toBe("Beginning and the terminal tail")
    await settleChat(() => history.resolve())
  })

  it("shows buffered partial text immediately on Stop until history reconciles", async () => {
    const { chat, handlers } = await start()
    const stopping = deferred<void>()
    vi.mocked(agentClient.stopGeneration).mockReturnValueOnce(stopping.promise)
    handlers.onToken("Beginning")
    await nextFrame()
    await settleChat(() => {
      handlers.onToken(" and the buffered partial")
      chat.stop()
    })
    expect(chat.streaming).toBe("Beginning and the buffered partial")
    await advance(100)
    expect(chat.streaming).toBe("Beginning and the buffered partial")
    await settleChat(() => stopping.resolve())
  })

  it("discards a pending publication on navigation and starts the next session on its own frame", async () => {
    const { chat, handlers } = await start()
    handlers.onToken("Old answer")
    await nextFrame()
    await settleChat(() => {
      handlers.onToken(" with an unpublished tail")
      chat.select(nextSession)
    })
    expect(chat.streaming).toBeNull()
    const next = queueStream(nextSession, null)
    await send(chat, "another reply")
    next.handlers.onToken("New answer")
    await nextFrame()
    expect(chat.streaming).toBe("New answer")
    await advance(100)
    expect(chat.streaming).toBe("New answer")
  })
})
