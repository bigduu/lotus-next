import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@services/api/errors"
import { agentClient, type ChildApprovalResponse, type GetSessionResponse } from "@services/chat/AgentService"
import { observeSessionExecutionConflict, type SessionExecutionCompatibility } from "@services/chat/sessionExecutionCompatibility"
import { appStore } from "@shared/store/appStore/state"
import { settleChat } from "./chatInteractionTestHarness"
import { deferred, feedSessions, queueStream, savedSession, session, useChatStreamFixture, user } from "./chatStreamTestHarness"

const mount = useChatStreamFixture()
const at = "2026-10-06T10:00:00Z"
const parent = "approval-target-parent"
const child = "approval-target-child"
const image = {
  base64: "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  name: "lifecycle.gif", size: 42, type: "image/gif",
}

type Status = SessionExecutionCompatibility["status"]

function report(status: Status): SessionExecutionCompatibility {
  return {
    session_version: status === "legacy_compatible" ? null : status === "conflict" ? 99 : 1,
    current_session_version: 1, status, history_readable: true, execution_allowed: status !== "conflict",
    conflicts: status === "conflict" ? [{ code: "unsupported_session_version", message: "Execution version is unsupported." }] : [],
  }
}

function detail(id: string, status?: Status): GetSessionResponse {
  const childSession = id === child || id === "new-child"
  return { session: {
    id, kind: childSession ? "child" : "root", title: id, title_version: 0, pinned: false,
    root_session_id: childSession ? parent : id, spawn_depth: childSession ? 1 : 0,
    model: "test-model", created_at: at, updated_at: at, last_activity_at: at,
    message_count: 0, has_attachments: false, is_running: false,
    ...(status ? { execution_compatibility: report(status) } : {}),
  } }
}

const conflict = (id: string) => new ApiError("incompatible", 409, "", JSON.stringify({
  session_id: id, error: { type: "conflict", code: "session_execution_incompatible", message: "incompatible" },
  compatibility: report("conflict"),
}))

const getDetail = () => vi.mocked(agentClient.getSession)
const submitChild = () => vi.mocked(agentClient.respondToChildApproval)

beforeEach(() => {
  vi.spyOn(agentClient, "patchSessionMessage").mockRejectedValue(new Error("Unexpected patch"))
  vi.spyOn(agentClient, "restoreSessionState").mockRejectedValue(new Error("Unexpected restore"))
  vi.spyOn(agentClient, "respondToChildApproval").mockResolvedValue({ delivered: true })
})

describe("Solid session execution compatibility v1", () => {
  it("blocks sending and destructive rerun only after explicit detail conflict", async () => {
    const id = "compatibility-conflict-session"
    const original = user("original-user", "old history")
    feedSessions([session(id, [original])])
    getDetail().mockResolvedValue(detail(id, "conflict"))
    const { chat } = await mount(id)
    await settleChat(async () => {
      await expect(chat.send("preserve this draft")).resolves.toMatchObject({ kind: "blocked" })
      await expect(chat.regenerate()).resolves.toBe(false)
      await expect(chat.editMessage(original.id, "edited draft")).resolves.toBe(false)
    })
    expect(agentClient.sendMessage).not.toHaveBeenCalled()
    expect(agentClient.execute).not.toHaveBeenCalled()
    expect(agentClient.truncateSessionMessages).not.toHaveBeenCalled()
    expect(agentClient.patchSessionMessage).not.toHaveBeenCalled()
    expect(agentClient.restoreSessionState).not.toHaveBeenCalled()
    expect(savedSession(id).messages).toEqual([original])
  })

  it.each([undefined, "compatible", "legacy_compatible"] as const)("keeps normal send available when report is %s", async (status) => {
    const id = `compatibility-open-${status ?? "missing"}`
    feedSessions([session(id)])
    getDetail().mockResolvedValue(detail(id, status))
    queueStream(id, "accepted-compatibility")
    const { chat } = await mount(id)
    await settleChat(async () => {
      await expect(chat.send("continue normally")).resolves.toMatchObject({ kind: "accepted", sessionId: id })
    })
    expect(agentClient.sendMessage).toHaveBeenCalledTimes(1)
    expect(agentClient.execute).toHaveBeenCalledTimes(1)
  })

  it("records a typed submit refusal once and recovers only after a fresh compatible detail", async () => {
    const id = "compatibility-submit-refusal"
    feedSessions([session(id)])
    getDetail().mockResolvedValue(detail(id))
    vi.mocked(agentClient.sendMessage).mockRejectedValueOnce(conflict(id))
    const { chat } = await mount(id)
    const send = () => chat.send("keep my content", { images: [image] })
    await settleChat(async () => { await expect(send()).resolves.toMatchObject({ kind: "blocked" }) })
    expect(chat.executionCompatibility.blocked).toBe(true)
    expect(chat.sendFailure).toBeNull()
    expect(chat.pendingUserMessages).toHaveLength(0)
    await settleChat(async () => { await expect(send()).resolves.toMatchObject({ kind: "blocked" }) })
    expect(agentClient.sendMessage).toHaveBeenCalledTimes(1)
    expect(agentClient.execute).not.toHaveBeenCalled()

    getDetail().mockResolvedValue(detail(id, "legacy_compatible"))
    await settleChat(() => chat.executionCompatibility.refresh())
    expect(chat.executionCompatibility.blocked).toBe(false)
    queueStream(id, "accepted-after-review")
    await settleChat(async () => { await expect(send()).resolves.toMatchObject({ kind: "accepted", sessionId: id }) })
    expect(agentClient.sendMessage).toHaveBeenCalledTimes(2)
    expect(chat.pendingUserImages[0]?.name).toBe(image.name)
  })

  it("keeps an acknowledged message when execute returns typed conflict and prevents retry", async () => {
    const id = "compatibility-execute-refusal"
    feedSessions([session(id)])
    getDetail().mockResolvedValue(detail(id, "compatible"))
    queueStream(id, "accepted-before-conflict")
    vi.mocked(agentClient.execute).mockRejectedValueOnce(conflict(id))
    const { chat } = await mount(id)
    await settleChat(async () => {
      await expect(chat.send("already saved", { images: [image] })).resolves.toMatchObject({ kind: "accepted", sessionId: id })
    })
    expect(chat.executionCompatibility.blocked).toBe(true)
    expect(chat.pendingUserText).toBe("already saved")
    expect(chat.pendingUserImages[0]?.name).toBe(image.name)
    expect(chat.sendFailure?.kind).toBe("generation-failed")
    await settleChat(() => chat.retry())
    expect(agentClient.execute).toHaveBeenCalledTimes(1)
    expect(agentClient.sendMessage).toHaveBeenCalledTimes(1)
    expect(agentClient.truncateSessionMessages).not.toHaveBeenCalled()
  })
})

describe("Solid Child approval compatibility", () => {
  const request = { toolName: "Write", permission: "write" }

  async function pending(childBlocked = false, childRead?: Promise<GetSessionResponse>) {
    feedSessions([{ ...session(parent), isRunning: true }])
    appStore.getState().markForceSubscribe(parent)
    getDetail().mockImplementation(async (id) => id === child && childRead
      ? childRead : detail(id, id === child && childBlocked ? "conflict" : "compatible"))
    const { chat } = await mount(parent)
    const notify = vi.mocked(agentClient.subscribeToEvents).mock.calls[0]?.[1].onChildApprovalRequested
    if (!notify) throw new Error("Expected the Parent's Child approval listener")
    await settleChat(() => notify(child, "request-7", request))
    return { chat, notify }
  }

  it.each([true, false])("submits the Human's %s decision to the compatible Child despite a parent conflict", async (approved) => {
    const { chat } = await pending()
    await settleChat(() => expect(observeSessionExecutionConflict(parent, conflict(parent))).toBe(true))
    expect(chat.executionCompatibility.blocked).toBe(true)
    expect(chat.pendingApproval?.childSessionId).toBe(child)
    expect(submitChild()).not.toHaveBeenCalled()
    await settleChat(() => chat.respondApproval(approved))
    expect(submitChild()).toHaveBeenCalledExactlyOnceWith(child, "request-7", approved)
    expect(agentClient.sendMessage).not.toHaveBeenCalled()
    expect(agentClient.execute).not.toHaveBeenCalled()
  })

  it("reads the Child's own report and retains its pending request through conflict and explicit recovery", async () => {
    const { chat } = await pending(true)
    expect(getDetail()).toHaveBeenCalledWith(child)
    expect(chat.approvalCompatibility.blocked).toBe(true)
    await settleChat(async () => { await chat.respondApproval(true); await chat.respondApproval(false) })
    expect(submitChild()).not.toHaveBeenCalled()
    expect(chat.pendingApproval?.requestId).toBe("request-7")
    getDetail().mockImplementation(async (id) => detail(id, "compatible"))
    await settleChat(() => chat.approvalCompatibility.refresh())
    expect(chat.approvalCompatibility.blocked).toBe(false)
    expect(submitChild()).not.toHaveBeenCalled()
    await settleChat(() => chat.respondApproval(false))
    expect(submitChild()).toHaveBeenCalledExactlyOnceWith(child, "request-7", false)
  })

  it.each([false, true])("retains a rejected Child approval and observes its typed conflict while detail is pending=%s", async (readPending) => {
    const staleRead = deferred<GetSessionResponse>()
    const { chat } = await pending(false, readPending ? staleRead.promise : undefined)
    const original = chat.pendingApproval
    submitChild().mockRejectedValueOnce(conflict(child))
    await settleChat(() => chat.respondApproval(true))
    expect(chat.pendingApproval).toBe(original)
    expect(chat.approvalCompatibility.blocked).toBe(true)
    expect(chat.executionCompatibility.blocked).toBe(false)
    await settleChat(() => chat.respondApproval(false))
    expect(submitChild()).toHaveBeenCalledExactlyOnceWith(child, "request-7", true)
    if (readPending) {
      await settleChat(() => staleRead.resolve(detail(child, "compatible")))
      expect(chat.approvalCompatibility.blocked).toBe(true)
    }
    getDetail().mockImplementation(async (id) => detail(id, "compatible"))
    await settleChat(() => chat.approvalCompatibility.refresh())
    expect(chat.approvalCompatibility.blocked).toBe(false)
    expect(submitChild()).toHaveBeenCalledTimes(1)
    await settleChat(() => chat.respondApproval(false))
    expect(submitChild()).toHaveBeenLastCalledWith(child, "request-7", false)
    expect(chat.pendingApproval).toBeNull()
    expect(agentClient.execute).not.toHaveBeenCalled()
    expect(agentClient.sendMessage).not.toHaveBeenCalled()
  })

  it.each(["network", "undelivered"])("retains an unconfirmed approval with an error and prevents concurrent submissions (%s)", async (failure) => {
    const { chat } = await pending()
    const response = deferred<ChildApprovalResponse>()
    submitChild().mockReturnValueOnce(response.promise)
    const original = chat.pendingApproval
    const submitting = chat.respondApproval(true)
    await settleChat(() => chat.respondApproval(false))
    expect(chat.pendingApproval).toBe(original)
    expect(chat.approvalSubmitting).toBe(true)
    expect(submitChild()).toHaveBeenCalledExactlyOnceWith(child, "request-7", true)
    await settleChat(async () => {
      if (failure === "network") response.reject(new Error("network lost"))
      else response.resolve({ delivered: false })
      await submitting
    })
    expect(chat.pendingApproval).toBe(original)
    expect(chat.approvalSubmitting).toBe(false)
    expect(chat.approvalError).toBeTruthy()
    expect(chat.approvalCompatibility.blocked).toBe(false)
    expect(submitChild()).toHaveBeenCalledTimes(1)
  })

  it.each(["success", "refusal"])("does not replace a newer approval when the previous submission settles (%s)", async (outcome) => {
    const { chat, notify } = await pending()
    const response = deferred<ChildApprovalResponse>()
    submitChild().mockReturnValueOnce(response.promise)
    const submitting = chat.respondApproval(true)
    await settleChat(() => notify("new-child", "request-8", request))
    await settleChat(async () => {
      if (outcome === "success") response.resolve({ delivered: true })
      else response.reject(conflict(child))
      await submitting
    })
    expect(chat.pendingApproval).toMatchObject({ childSessionId: "new-child", requestId: "request-8" })
    expect(chat.approvalCompatibility.blocked).toBe(false)
    expect(chat.approvalError).toBeNull()
    expect(submitChild()).toHaveBeenCalledExactlyOnceWith(child, "request-7", true)
  })

  it("a cached approval callback still respects a later conflict for that exact Child", async () => {
    const { chat } = await pending()
    const cached = chat.respondApproval
    await settleChat(() => expect(observeSessionExecutionConflict(child, conflict(child))).toBe(true))
    await settleChat(() => cached(true))
    expect(submitChild()).not.toHaveBeenCalled()
    expect(chat.pendingApproval?.requestId).toBe("request-7")
  })
})
