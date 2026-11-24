import { describe, expect, it, vi } from "vitest"
import { agentClient } from "@services/chat/AgentService"
import { appStore, initializeStore } from "@shared/store/appStore/state"
import { invalidateCompletedAnswers } from "@/lib/completedAnswerHandoffRegistry"
import { settleChat } from "./chatInteractionTestHarness"
import { appendPersistedUser, assistant, deferred, feedMessages, feedSessions, history, queueStream,
  savedSession, session, startedRun, useChatStreamFixture, user, type Chat } from "./chatStreamTestHarness"

vi.mock("@shared/store/appStore/state", async (original) => ({
  ...await original<typeof import("@shared/store/appStore/state")>(),
  initializeStore: vi.fn(async () => {}),
}))

const mount = useChatStreamFixture()
const answer = "Synthetic completed answer retained until its own canonical history arrives."
const firstRequest = "Synthetic first request"
const followUp = "Synthetic follow-up"
const contextSummary = "Synthetic context-only summary"

const visibleAnswers = (chat: Chat) => [
  ...chat.messages.flatMap((message) => message.role === "assistant" && "content" in message ? [message.content] : []),
  ...(chat.streaming ? [chat.streaming] : []),
]
const visibleCount = (chat: Chat, text = answer) => visibleAnswers(chat).filter((body) => body === text).length
const handoffs = (chat: Chat) => chat.messages.filter((message) => message.id.startsWith("completed-answer-handoff-"))

async function send(chat: Chat, text: string) {
  await settleChat(async () => {
    await expect(chat.send(text)).resolves.toMatchObject({ kind: "accepted" })
  })
}

function finish(stream: ReturnType<typeof queueStream>, text = answer, replay = false) {
  return settleChat(() => {
    stream.handlers.onToken(text)
    stream.handlers.onComplete(undefined)
    if (replay) stream.handlers.onComplete(undefined)
    stream.subscription.resolve()
  })
}

async function completed(compressed: boolean, mode: "main" | "bound" = "bound") {
  const sid = `synthetic-answer-handoff-${compressed}-${mode}`
  appStore.setState({ currentSessionId: sid })
  feedSessions([session(sid, [
    user("previous-user", "Synthetic old request"),
    assistant("previous-answer", "Synthetic old answer", compressed, "2026-10-27T00:00:01Z"),
  ])])
  const first = queueStream(sid, "current-user")
  const pane = await mount(mode === "main" ? undefined : sid)
  await send(pane.chat, firstRequest)
  await settleChat(() => appendPersistedUser(sid, firstRequest, "current-user"))
  if (compressed) {
    await settleChat(() => {
      first.handlers.onContextCompressionStatus("preflight", "started")
      first.handlers.onContextSummarized({ summary: contextSummary, messages_summarized: 2, tokens_saved: 100 })
      first.handlers.onContextCompressionStatus("preflight", "completed")
    })
  }
  await finish(first, answer, true)
  expect(pane.chat.sending).toBe(false)
  expect(visibleCount(pane.chat)).toBe(1)
  return { pane, first, sid }
}

function beforeNextUser(sid: string, message: ReturnType<typeof assistant>) {
  const messages = savedSession(sid).messages
  const next = messages.findIndex((item) => item.id === "next-user")
  expect(next).toBeGreaterThanOrEqual(0)
  feedMessages(sid, [...messages.slice(0, next), message, ...messages.slice(next)])
}

describe("Solid completed answer followed by another turn", () => {
  it.each([
    { compressed: false, mode: "main" }, { compressed: true, mode: "main" },
    { compressed: false, mode: "bound" }, { compressed: true, mode: "bound" },
  ] as const)("keeps a completed answer during immediate follow-up: $mode, compression=$compressed", async ({ compressed, mode }) => {
    const { pane, sid } = await completed(compressed, mode)
    if (mode === "main") expect(initializeStore).toHaveBeenCalled()
    queueStream(sid, "next-user")
    await send(pane.chat, followUp)
    expect(visibleCount(pane.chat)).toBe(1)
    expect(pane.chat.messages.some((message) => "content" in message && message.content === contextSummary)).toBe(false)
  })

  it.each([false, true])("shows one completed answer through a partial history checkpoint after follow-up (compression=%s)", async (compressed) => {
    const { pane, sid } = await completed(compressed)
    queueStream(sid, "next-user")
    await send(pane.chat, followUp)
    const partial = assistant("canonical-answer", answer.slice(0, 20), compressed)
    await settleChat(() => {
      appendPersistedUser(sid, followUp, "next-user")
      beforeNextUser(sid, partial)
    })
    expect(visibleCount(pane.chat)).toBe(1)
    expect(visibleAnswers(pane.chat)).not.toContain(partial.content)
    expect(savedSession(sid).messages).toContain(partial)

    await settleChat(() => feedMessages(sid, savedSession(sid).messages.map((message) =>
      message.id === partial.id ? { ...partial, content: answer } : message)))
    expect(visibleCount(pane.chat)).toBe(1)
    expect(handoffs(pane.chat)).toEqual([])
  })

  it("keeps a completed answer when an intermediate body was saved before the completion event", async () => {
    const sid = "synthetic-intermediate-before-completion"
    feedSessions([session(sid)])
    const first = queueStream(sid, "current-user")
    const pane = await mount(sid)
    await send(pane.chat, firstRequest)
    await settleChat(() => feedMessages(sid, [user("current-user", firstRequest),
      assistant("intermediate", "Synthetic intermediate step")]))
    await finish(first)
    expect(visibleAnswers(pane.chat)).toContain("Synthetic intermediate step")
    expect(visibleCount(pane.chat)).toBe(1)
  })

  it("keeps a completed answer when delayed history contains a different intermediate body", async () => {
    const { pane, sid } = await completed(true)
    queueStream(sid, "next-user")
    await send(pane.chat, followUp)
    await settleChat(() => {
      appendPersistedUser(sid, followUp, "next-user")
      beforeNextUser(sid, assistant("intermediate", "Synthetic intermediate step"))
    })
    expect(visibleAnswers(pane.chat)).toContain("Synthetic intermediate step")
    expect(visibleCount(pane.chat)).toBe(1)
  })

  it("retires a delayed canonical reply between its exact user and a later user, then honors a history edit", async () => {
    const { pane, sid } = await completed(true)
    queueStream(sid, "next-user")
    await send(pane.chat, followUp)
    const canonical = assistant("canonical-answer", answer, true, "2026-10-27T00:00:03Z")
    await settleChat(() => feedMessages(sid, [...savedSession(sid).messages, canonical,
      user("next-user", followUp, "2026-10-27T00:00:04Z")]))
    expect(visibleCount(pane.chat)).toBe(1)
    expect(handoffs(pane.chat)).toEqual([])
    await settleChat(() => feedMessages(sid, savedSession(sid).messages.filter((message) => message.id !== canonical.id)))
    expect(visibleAnswers(pane.chat)).not.toContain(answer)
  })

  it("does not mistake an empty assistant checkpoint for persistence of the displayed final body", async () => {
    const { pane, sid } = await completed(true)
    await settleChat(() => feedMessages(sid, [...savedSession(sid).messages, assistant("empty-final-checkpoint", "")]))
    expect(visibleCount(pane.chat)).toBe(1)
  })

  it("keeps separate session handoffs through navigation without rendering another session's reply", async () => {
    const { pane, sid } = await completed(true)
    const other = "synthetic-other-session"
    feedSessions([savedSession(sid), session(other)])
    await pane.rebind(other)
    expect(visibleAnswers(pane.chat)).not.toContain(answer)
    queueStream(other, "other-user")
    await send(pane.chat, "Synthetic other session request")
    expect(visibleAnswers(pane.chat)).not.toContain(answer)
    await pane.rebind(sid)
    expect(visibleCount(pane.chat)).toBe(1)
    expect(pane.chat.pendingUserMessages.some((pending) => pending.text === "Synthetic other session request")).toBe(false)
  })

  it.each([false, true])("retains a finished reply after unmount before a follow-up (compression=%s)", async (compressed) => {
    const { pane, sid } = await completed(compressed)
    pane.unmount()
    const restored = await mount(sid)
    expect(visibleCount(restored.chat)).toBe(1)
  })

  it.each([false, true])("keeps only its own unfinished history across remount after follow-up (compression=%s)", async (compressed) => {
    const { pane, sid } = await completed(compressed)
    queueStream(sid, "next-user")
    await send(pane.chat, followUp)
    await settleChat(() => appendPersistedUser(sid, followUp, "next-user"))
    pane.unmount()
    const other = "synthetic-remount-other"
    feedSessions([savedSession(sid), session(other)])
    const unrelated = await mount(other)
    expect(visibleAnswers(unrelated.chat)).not.toContain(answer)
    unrelated.unmount()
    const restored = await mount(sid)
    expect(visibleCount(restored.chat)).toBe(1)
    const canonical = assistant("canonical-remount-answer", answer, compressed)
    await settleChat(() => beforeNextUser(sid, canonical))
    expect(visibleCount(restored.chat)).toBe(1)
    expect(handoffs(restored.chat)).toEqual([])
    await settleChat(() => feedMessages(sid, savedSession(sid).messages.filter((message) => message.id !== canonical.id)))
    restored.unmount()
    const edited = await mount(sid)
    expect(visibleAnswers(edited.chat)).not.toContain(answer)
  })

  it("retains a terminal body when the final history request is still in flight at unmount", async () => {
    const sid = "synthetic-pending-history-remount"
    feedSessions([session(sid)])
    const first = queueStream(sid, "current-user")
    const pane = await mount(sid)
    await send(pane.chat, "Synthetic request")
    await settleChat(() => appendPersistedUser(sid, "Synthetic request", "current-user"))
    const delayedHistory = deferred<void>()
    history().mockReturnValueOnce(delayedHistory.promise)
    await finish(first)
    expect(history()).toHaveBeenLastCalledWith(sid, expect.objectContaining({ mode: "monotonic", waitForAssistant: true }))
    expect(pane.chat.streamPhase).toBe("finalizing")
    expect(visibleCount(pane.chat)).toBe(1)
    pane.unmount()
    const restored = await mount(sid)
    expect(visibleCount(restored.chat)).toBe(1)
    await settleChat(() => feedMessages(sid, [...savedSession(sid).messages, assistant("saved-answer", answer)]))
    await settleChat(() => delayedHistory.resolve())
    expect(visibleCount(restored.chat)).toBe(1)
    expect(handoffs(restored.chat)).toEqual([])
  })

  it("retires the exact completed turn after a confirmed regenerate truncate and ignores its late events", async () => {
    const { pane, first, sid } = await completed(true)
    vi.mocked(agentClient.truncateSessionMessages).mockResolvedValueOnce({
      success: true, session_id: sid, messages_removed: 1, message_count: 3,
    })
    await settleChat(() => { void pane.chat.regenerate() })
    expect(agentClient.truncateSessionMessages).toHaveBeenCalledExactlyOnceWith(sid, { mode: "after_last_user" })
    expect(agentClient.execute).toHaveBeenCalledTimes(2)
    expect(visibleAnswers(pane.chat)).not.toContain(answer)
    await finish(first)
    expect(visibleAnswers(pane.chat)).not.toContain(answer)
    pane.unmount()
    const restored = await mount(sid)
    expect(visibleAnswers(restored.chat)).not.toContain(answer)
  })

  it("does not resurrect a still-streaming answer after a confirmed clear", async () => {
    const sid = "synthetic-clear-before-terminal"
    feedSessions([session(sid)])
    const first = queueStream(sid, "current-user")
    const pane = await mount(sid)
    await send(pane.chat, "Synthetic request")
    await settleChat(() => appendPersistedUser(sid, "Synthetic request", "current-user"))
    await settleChat(() => first.handlers.onToken(answer))
    await settleChat(() => invalidateCompletedAnswers(sid))
    const delayedHistory = deferred<void>()
    history().mockReturnValueOnce(delayedHistory.promise)
    await finish(first)
    expect(visibleAnswers(pane.chat).some((body) => body.includes(answer))).toBe(false)
    pane.unmount()
    const restored = await mount(sid)
    await settleChat(() => delayedHistory.resolve())
    expect(visibleAnswers(restored.chat).some((body) => body.includes(answer))).toBe(false)
  })

  it("drops the confirmed deleted user turn and ignores its late completion", async () => {
    const { pane, first, sid } = await completed(true)
    const invalidateHistory = vi.spyOn(appStore.getState(), "invalidateHistoryAfterMessageDelete")
    vi.mocked(agentClient.deleteSessionMessage).mockResolvedValueOnce(undefined)
    await settleChat(async () => { await expect(pane.chat.deleteMessage("current-user")).resolves.toBe(true) })
    expect(invalidateHistory).toHaveBeenCalledWith(sid, "current-user")
    expect(history()).toHaveBeenCalledWith(sid, { resetHistoryWindow: true })
    expect(visibleAnswers(pane.chat)).not.toContain(answer)
    await finish(first)
    expect(visibleAnswers(pane.chat)).not.toContain(answer)
    pane.unmount()
    const restored = await mount(sid)
    expect(visibleAnswers(restored.chat)).not.toContain(answer)
  })

  it("keeps two distinct turns when a remounted pane reuses operation number one", async () => {
    const { pane, sid } = await completed(true)
    pane.unmount()
    const resumed = await mount(sid)
    const second = queueStream(sid, "second-user")
    await send(resumed.chat, "Synthetic second request")
    await settleChat(() => appendPersistedUser(sid, "Synthetic second request", "second-user"))
    const secondAnswer = "Synthetic second completed answer"
    await finish(second, secondAnswer)
    resumed.unmount()
    const restored = await mount(sid)
    expect(visibleCount(restored.chat)).toBe(1)
    expect(visibleCount(restored.chat, secondAnswer)).toBe(1)
    expect(handoffs(restored.chat)).toHaveLength(2)
    expect(new Set(restored.chat.messages.map((message) => message.id)).size).toBe(restored.chat.messages.length)
  })

  it("shows one final body in two panes when the same run identity is confirmed", async () => {
    const id = "synthetic-answer-handoff-true-bound"
    vi.mocked(agentClient.execute).mockResolvedValue(startedRun(id, "same-confirmed-run"))
    const { pane, sid } = await completed(true)
    const observer = await mount(sid)
    const second = queueStream(sid, "current-user")
    await send(observer.chat, firstRequest)
    await settleChat(async () => {
      second.handlers.onToken(answer)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    })
    expect(visibleCount(observer.chat)).toBe(1)
    await settleChat(() => {
      second.handlers.onComplete(undefined)
      second.subscription.resolve()
    })
    expect(visibleCount(observer.chat)).toBe(1)
    pane.unmount()
    observer.unmount()
    expect(visibleCount((await mount(sid)).chat)).toBe(1)
  })

  it("does not let one saved answer confirm two distinct runs with the same user and text", async () => {
    const id = "synthetic-answer-handoff-true-bound"
    vi.mocked(agentClient.execute).mockResolvedValueOnce(startedRun(id, "first-run"))
    const { pane, sid } = await completed(true)
    pane.unmount()
    const next = await mount(sid)
    const second = queueStream(sid, "current-user")
    vi.mocked(agentClient.execute).mockResolvedValueOnce(startedRun(sid, "second-run"))
    await send(next.chat, firstRequest)
    await finish(second)
    next.unmount()
    const restored = await mount(sid)
    expect(visibleCount(restored.chat)).toBe(2)
    const messages = [...savedSession(sid).messages, assistant("saved-first-run", answer)]
    await settleChat(() => feedMessages(sid, messages))
    expect(visibleCount(restored.chat)).toBe(2)
    expect(handoffs(restored.chat)).toHaveLength(1)
    await settleChat(() => feedMessages(sid, [...messages]))
    expect(handoffs(restored.chat)).toHaveLength(1)
  })

  it.each(["another-pane", "bootstrap"] as const)("keeps an unresolved reply when its session is temporarily absent during %s", async (mode) => {
    const { pane, sid } = await completed(true)
    const saved = savedSession(sid)
    pane.unmount()
    feedSessions(mode === "bootstrap" ? [] : [session("partial-list-other")])
    const temporary = await mount(mode === "bootstrap" ? null : "partial-list-other")
    expect(visibleAnswers(temporary.chat)).not.toContain(answer)
    temporary.unmount()
    feedSessions([...appStore.getState().chats, saved])
    expect(visibleCount((await mount(sid)).chat)).toBe(1)
  })

  it("matches the restored canonical transcript after remount without storing a transient duplicate", async () => {
    const { pane, sid } = await completed(true)
    queueStream(sid, "next-user")
    await send(pane.chat, followUp)
    const before = visibleAnswers(pane.chat).filter((body) => body === answer)
    pane.unmount()
    feedMessages(sid, [...savedSession(sid).messages, assistant("canonical-restored-answer", answer)])
    const restored = await mount(sid)
    expect(visibleAnswers(restored.chat).filter((body) => body === answer)).toEqual(before)
    expect(handoffs(restored.chat)).toEqual([])
  })

  it("reconciles four compressed follow-ups to the same canonical transcript without accumulating duplicate bodies", async () => {
    const { pane, sid } = await completed(true)
    const replies = [answer]
    for (let index = 2; index <= 4; index += 1) {
      const next = queueStream(sid, `user-${index}`)
      const text = `Synthetic request ${index}`
      await send(pane.chat, text)
      await settleChat(() => appendPersistedUser(sid, text, `user-${index}`))
      const reply = `Synthetic completed reply ${index}`
      replies.push(reply)
      await finish(next, reply)
      expect(visibleAnswers(pane.chat).filter((body) => replies.includes(body))).toEqual(replies)
    }
    await settleChat(() => feedMessages(sid, replies.flatMap((text, index) => [
      user(index === 0 ? "current-user" : `user-${index + 1}`, `Synthetic request ${index + 1}`),
      assistant(`canonical-final-${index + 1}`, text, true),
    ])))
    expect(visibleAnswers(pane.chat).filter((body) => replies.includes(body))).toEqual(replies)
    expect(handoffs(pane.chat)).toEqual([])
    expect(pane.chat.streaming).toBeNull()
  })
})
