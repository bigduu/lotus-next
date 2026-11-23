import { describe, expect, it } from "vitest"
import { diagnosticFixture, diagnosticFixtureError } from "@services/chat/runDiagnostic.testFixtures"
import { settleChat } from "./chatInteractionTestHarness"
import { feedSessions, queueStream, session, useChatStreamFixture, type Chat } from "./chatStreamTestHarness"

const mount = useChatStreamFixture()

const send = (chat: Chat, text: string) => settleChat(async () => {
  await expect(chat.send(text)).resolves.toMatchObject({ kind: "accepted" })
})

describe("Solid owned public run diagnostics", () => {
  it("retains only this failure and rejects old terminal diagnostics after the next same-session run", async () => {
    const id = "diagnostic-session"
    feedSessions([session(id)])
    const old = queueStream(id, "synthetic-first-user")
    const pane = await mount(id)
    await send(pane.chat, "synthetic first")
    const diagnostic = diagnosticFixture(id)
    await settleChat(() => {
      old.handlers.onError(diagnosticFixtureError, diagnostic)
      old.subscription.resolve()
    })
    const previous = pane.chat.sendFailure
    expect(previous).toMatchObject({ kind: "generation-failed", sessionId: id, diagnostic })
    if (previous?.kind !== "generation-failed") throw new Error("Expected the first run's terminal diagnostic")

    const current = queueStream(id, "synthetic-next-user")
    await send(pane.chat, "synthetic next")
    expect(pane.chat.sendFailure).toBeNull()
    await settleChat(() => old.handlers.onError(diagnosticFixtureError, diagnostic))
    expect(pane.chat.sendFailure).toBeNull()
    await settleChat(() => {
      current.handlers.onError("legacy current error")
      current.subscription.resolve()
    })
    const next = pane.chat.sendFailure
    expect(next).toMatchObject({ kind: "generation-failed", message: "legacy current error" })
    if (next?.kind !== "generation-failed") throw new Error("Expected the successor's legacy error")
    expect(next.operationId).toBeGreaterThan(previous.operationId)
    expect(next.diagnostic).toBeUndefined()
  })

  it("does not apply a late error or diagnostic after switching the bound conversation", async () => {
    const id = "diagnostic-original"
    const other = "diagnostic-other"
    feedSessions([session(id), session(other)])
    const old = queueStream(id, "synthetic-user")
    const pane = await mount(id)
    await send(pane.chat, "synthetic request")
    await pane.rebind(other)
    await settleChat(() => {
      old.handlers.onError(diagnosticFixtureError, diagnosticFixture(id))
      old.subscription.resolve()
    })
    expect(pane.chat.currentSessionId).toBe(other)
    expect(pane.chat.sendFailure).toBeNull()
  })
})
