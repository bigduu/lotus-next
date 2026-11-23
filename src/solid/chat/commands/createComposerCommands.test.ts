import { createEffect, createRoot, createSignal } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { agentClient, type ChatResponse, type SessionCompactionReceipt } from "@services/chat/AgentService"
import { ApiError } from "@services/api/errors"
import type { SessionLoopStatus } from "@services/chat/sessionLoop"
import { clearSessionCompatibilityObservations, observeSessionExecutionConflict } from "@services/chat/sessionExecutionCompatibility"
import { currentUserManagedSessionsFixture } from "@services/supervisorScope/testFixtures"
import { appStore } from "@shared/store/appStore/state"
import type { ChatItem } from "@shared/types/chatMessages"
import type { SkillDefinition } from "@shared/types/skill"
import { uiText } from "@shared/i18n/text"
import { beginRootModeOperation } from "@/lib/rootModeTransitionState"
import { DEFAULT_SUPERVISOR_SESSION_ID } from "@/lib/supervisor"
import { settleChat } from "../chatInteractionTestHarness"
import { createComposerCommands, type ComposerCommandsOptions } from "./createComposerCommands"

const mainId = "command-session"
const otherId = "other-command-session"
const skill: SkillDefinition = { id: "example", name: "Example", description: "", prompt: "", tool_refs: [] }
let cleanup: (() => void) | undefined

function session(id: string): ChatItem {
  return {
    id, kind: "root", title: id, createdAt: 1, messages: [],
    config: { systemPromptId: "", baseSystemPrompt: "", lastUsedEnhancedPrompt: null },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

function goalAck(action: string, shouldExecute = false): ChatResponse {
  return { session_id: mainId, status: "accepted", goal_command: { action, should_execute: shouldExecute } }
}

async function mount(options: {
  newChat?: boolean; attachments?: boolean; running?: boolean; thinkingMode?: "standard" | "ultra"; sessionId?: string
} = {}) {
  const initial = options.newChat ? null : options.sessionId ?? mainId
  const [id, setId] = createSignal<string | null>(initial)
  const [running, setRunning] = createSignal(options.running ?? false)
  appStore.setState({ currentSessionId: initial })
  const key = () => id() ?? ""
  const draft = () => appStore.getState().getInputState(key())
  const openGoal = vi.fn()
  const openWorkflowRuns = vi.fn()
  const observedMenus: Array<string | null> = []
  const commands = createRoot((dispose) => {
    cleanup = dispose
    const chat = {
      get currentSessionId() { return id() },
      get currentChat() { return appStore.getState().chats.find((item) => item.id === id()) },
      executionCompatibility: { blocked: false }, submissionPending: false,
    } as ComposerCommandsOptions["chat"]
    const model = createComposerCommands({
      chat, draftKey: key, inputId: "command-editor", workspacePath: () => null,
      running, blocked: () => false, hasAttachments: () => options.attachments === true,
      queueBusy: () => false, queuePending: () => false, thinkingMode: () => options.thinkingMode ?? "standard", openGoal, openWorkflowRuns,
    })
    createEffect(() => model.slashQuery, (query) => { observedMenus.push(query) })
    return model
  })
  await settleChat()
  return {
    commands, draft, openGoal, openWorkflowRuns, observedMenus,
    setRunning: (next: boolean) => settleChat(() => setRunning(next)),
    write: (content: string, target = key()) => settleChat(() => appStore.getState().setInputContent(target, content)),
    rebind: (target: string) => settleChat(() => { setId(target); appStore.setState({ currentSessionId: target }) }),
    submit: async () => {
      const result = await commands.handleSubmit(draft())
      await settleChat()
      return result
    },
  }
}

beforeEach(() => {
  clearSessionCompatibilityObservations()
  appStore.setState({ ...appStore.getInitialState(), chats: [session(mainId), session(otherId)],
    loadChatHistory: vi.fn(async () => {}),
  }, true)
  vi.spyOn(agentClient, "sendMessage").mockResolvedValue(goalAck("set"))
  vi.spyOn(agentClient, "resumeGoal").mockResolvedValue(goalAck("resume"))
  vi.spyOn(agentClient, "execute").mockRejectedValue(new Error("No Execute expected"))
  vi.spyOn(agentClient, "compactSessionContext").mockResolvedValue({ session_id: mainId, status: "unchanged" })
  vi.spyOn(agentClient, "applySessionLoop").mockImplementation(async (id) => ({ session_id: id, loop: null }))
})

afterEach(async () => {
  cleanup?.()
  cleanup = undefined
  await settleChat()
  vi.restoreAllMocks()
})

describe("Solid slash command ownership", () => {
  it("keeps a dismissed slash menu closed for identical text and reopens only for a changed prefix or pane", async () => {
    const pane = await mount()
    await pane.write("/a")
    expect(pane.commands.slashQuery).toBe("a")
    await settleChat(() => pane.commands.dismiss())
    expect(pane.commands.slashQuery).toBeNull()
    pane.observedMenus.length = 0
    const dismissedRevision = pane.draft().contentRevision
    await pane.write("/a")
    expect(pane.draft().contentRevision).toBeGreaterThan(dismissedRevision)
    expect(pane.commands.slashQuery).toBeNull()
    expect(pane.observedMenus).toEqual([])
    await pane.write("/ab")
    expect(pane.observedMenus).toEqual(["ab"])
    pane.observedMenus.length = 0
    for (let length = 1; length <= 64; length++) await pane.write(`/ab${"x".repeat(length)}`)
    await pane.write("/a")
    expect(pane.commands.slashQuery).toBe("a")
    expect(pane.observedMenus).toHaveLength(65)
    expect(pane.observedMenus).not.toContain(null)
    await settleChat(() => pane.commands.dismiss())
    await pane.write("/a", otherId)
    expect(pane.commands.slashQuery).toBeNull()
    await pane.rebind(otherId)
    expect(pane.commands.slashQuery).toBe("a")
  })

  it("opens workflow runs for the current session without posting or modifying the command draft", async () => {
    const pane = await mount()
    await pane.write("/workflow")
    expect(await pane.submit()).toBe("handled")
    expect(pane.openWorkflowRuns).toHaveBeenCalledExactlyOnceWith(mainId)
    expect(pane.commands.slashQuery).toBeNull()
    expect(pane.draft().content).toBe("/workflow")
    expect(agentClient.sendMessage).not.toHaveBeenCalled()
    expect(agentClient.execute).not.toHaveBeenCalled()
  })

  it("keeps a failed compact menu selection ready to retry as a command", async () => {
    const receipt = deferred<SessionCompactionReceipt>()
    const compact = vi.mocked(agentClient.compactSessionContext).mockReturnValueOnce(receipt.promise)
    const pane = await mount()
    await pane.write("/co")
    await settleChat(() => pane.commands.pickCompact())
    try {
      expect(pane.draft().content).toBe("/compact")
      expect(pane.commands.slashQuery).toBeNull()
      expect(pane.commands.compactPending).toBe(true)
      expect(compact).toHaveBeenCalledExactlyOnceWith(mainId)
    } finally {
      await settleChat(() => receipt.reject(new Error("offline")))
    }
    expect(pane.draft().content).toBe("/compact")
    expect(pane.commands.notice).toMatchObject({ error: true, message: uiText("compact_context_unconfirmed") })
    await settleChat(() => { expect(pane.commands.handleCompact(pane.draft())).toBe(true) })
    expect(compact).toHaveBeenCalledTimes(2)
    expect(appStore.getState().loadChatHistory).not.toHaveBeenCalled()
    expect(pane.commands.notice?.message).toBe(uiText("compact_context_unchanged"))
    expect(pane.draft().content).toBe("")
    expect(agentClient.sendMessage).not.toHaveBeenCalled()
  })
})

describe("Solid Goal command admission", () => {
  it("handles a Goal command without submitting an ordinary chat turn", async () => {
    const pane = await mount()
    const message = "/goal 完成测试并说明结果"
    await pane.write(message)
    expect(await pane.submit()).toBe("handled")
    expect(agentClient.sendMessage).toHaveBeenCalledExactlyOnceWith({ session_id: mainId, model: "", message })
    expect(agentClient.execute).not.toHaveBeenCalled()
    expect(pane.draft().content).toBe("")
  })

  it.each([true, false])("uses the dedicated resume endpoint and retains a failed command (%s)", async (supported) => {
    if (!supported) vi.mocked(agentClient.resumeGoal).mockRejectedValueOnce(new ApiError("Missing route", 404, "Not Found"))
    const pane = await mount()
    const message = "/GOAL\u0085Resume"
    await pane.write(message)
    expect(await pane.submit()).toBe("handled")
    expect(agentClient.resumeGoal).toHaveBeenCalledExactlyOnceWith(mainId)
    expect(agentClient.sendMessage).not.toHaveBeenCalled()
    expect(agentClient.execute).not.toHaveBeenCalled()
    expect(pane.draft().content).toBe(supported ? "" : message)
    expect(pane.commands.notice?.message).toBe(uiText(supported ? "goal_resume_queued" : "goal_resume_unavailable"))
  })

  it.each(["attachment", "skill", "new chat"] as const)("keeps Goal resume out of ordinary chat with %s", async (block) => {
    const pane = await mount({ attachments: block === "attachment", newChat: block === "new chat" })
    if (block === "skill") await settleChat(() => pane.commands.pickSkill(skill))
    await pane.write("/goal resume")
    expect(await pane.submit()).toBe("handled")
    expect(agentClient.resumeGoal).not.toHaveBeenCalled()
    expect(agentClient.sendMessage).not.toHaveBeenCalled()
    expect(agentClient.execute).not.toHaveBeenCalled()
    expect(pane.draft().content).toBe("/goal resume")
  })

  it("retains a Goal command when saving fails", async () => {
    vi.mocked(agentClient.sendMessage).mockRejectedValueOnce(new Error("offline"))
    const pane = await mount()
    await pane.write("/goal 保留草稿")
    expect(await pane.submit()).toBe("handled")
    expect(pane.draft().content).toBe("/goal 保留草稿")
    expect(pane.commands.notice).toMatchObject({ error: true, detail: "offline" })
    expect(agentClient.execute).not.toHaveBeenCalled()
  })

  it("clears a confirmed Goal off command without executing another turn", async () => {
    vi.mocked(agentClient.sendMessage).mockResolvedValueOnce(goalAck("off"))
    const pane = await mount()
    await pane.write("/goal off")
    expect(await pane.submit()).toBe("handled")
    expect(agentClient.sendMessage).toHaveBeenCalledExactlyOnceWith({ session_id: mainId, model: "", message: "/goal off" })
    expect(agentClient.execute).not.toHaveBeenCalled()
    expect(pane.draft().content).toBe("")
    expect(pane.commands.notice?.message).toBe(uiText("goal_paused_c6289896"))
  })

  it("executes a Goal submitted during a live turn only after its acknowledgement", async () => {
    const receipt = deferred<ChatResponse>()
    vi.mocked(agentClient.sendMessage).mockReturnValueOnce(receipt.promise)
    vi.mocked(agentClient.execute).mockResolvedValueOnce({
      session_id: mainId, status: "already_running", events_url: "/v2/stream",
    })
    const pane = await mount({ running: true })
    await pane.write("/goal 完成新的目标")
    try {
      expect(await pane.submit()).toBe("handled")
      expect(agentClient.sendMessage).toHaveBeenCalledTimes(1)
      expect(agentClient.execute).not.toHaveBeenCalled()
      expect(pane.draft().content).toBe("/goal 完成新的目标")
    } finally {
      await settleChat(() => receipt.resolve(goalAck("set_prompt", true)))
    }
    expect(agentClient.execute).toHaveBeenCalledExactlyOnceWith(mainId, undefined)
    expect(pane.draft().content).toBe("")
  })

  it("blocks a Goal command and preserves its draft while a Root mode operation is pending", async () => {
    const pane = await mount({ running: true })
    expect(beginRootModeOperation(mainId, 0, "a".repeat(64), false)).not.toBeNull()
    await pane.write("/goal continue")
    expect(await pane.submit()).toBe("handled")
    expect(agentClient.sendMessage).not.toHaveBeenCalled()
    expect(agentClient.execute).not.toHaveBeenCalled()
    expect(pane.draft().content).toBe("/goal continue")
    expect(pane.commands.notice?.message).toBe(uiText("the_root_permission_change_is_unconfirmed_sending_and_e_a75a6b4f"))
  })

  it("does not execute a saved Goal if another tab fences the Session before its history follow-up", async () => {
    const history = deferred<void>()
    vi.mocked(appStore.getState().loadChatHistory).mockReturnValueOnce(history.promise)
    vi.mocked(agentClient.sendMessage).mockResolvedValueOnce(goalAck("set", true))
    const pane = await mount()
    await pane.write("/goal complete later")
    try {
      expect(await pane.submit()).toBe("handled")
      expect(agentClient.sendMessage).toHaveBeenCalledTimes(1)
      expect(appStore.getState().loadChatHistory).toHaveBeenCalledExactlyOnceWith(mainId)
      expect(pane.draft().content).toBe("")
      expect(beginRootModeOperation(mainId, 0, "a".repeat(64), true)).not.toBeNull()
    } finally {
      await settleChat(() => history.resolve())
    }
    expect(agentClient.execute).not.toHaveBeenCalled()
    expect(pane.commands.notice?.message).toBe(uiText("root_permissions_are_unconfirmed_the_goal_was_saved_but_bd40481a"))
  })

  it("a cached Goal submit callback cannot bypass a later explicit compatibility refusal", async () => {
    const pane = await mount()
    await pane.write("/goal preserve this objective")
    const submit = pane.commands.handleSubmit
    expect(observeSessionExecutionConflict(mainId, new ApiError("incompatible", 409, "", JSON.stringify({
      session_id: mainId,
      error: { code: "session_execution_incompatible" },
      compatibility: { session_version: null, current_session_version: 1, status: "conflict", history_readable: true,
        execution_allowed: false, conflicts: [{ code: "unsupported_runtime_state_version", message: "Unsupported runtime format" }] },
    })))).toBe(true)
    expect(await submit(pane.draft())).toBe("handled")
    expect(agentClient.sendMessage).not.toHaveBeenCalled()
    expect(agentClient.execute).not.toHaveBeenCalled()
    expect(pane.draft().content).toBe("/goal preserve this objective")
  })
})

describe("Solid Session loop commands", () => {
  it.each([
    ["/loop 5m 检查部署\nKeep  spacing", { action: "start", interval_seconds: 300, prompt: "检查部署\nKeep  spacing" }],
    ["/LOOP STATUS", { action: "status" }],
    ["/loop status?", { action: "status" }],
    ["/loop stop！", { action: "stop" }],
    ["/loop RESUME。", { action: "resume" }],
    ["/loop resume", { action: "resume" }],
  ] as const)("sends %s through the dedicated loop API", async (draft, request) => {
    vi.mocked(agentClient.applySessionLoop).mockResolvedValueOnce({
      session_id: mainId, loop: { state: "scheduled", next_fire_at: "2026-11-19T13:00:00Z", last_run_status: "failed" },
    })
    const pane = await mount()
    await pane.write(draft)
    expect(await pane.submit()).toBe("handled")
    expect(agentClient.applySessionLoop).toHaveBeenCalledExactlyOnceWith(mainId, request)
    expect(pane.commands.notice?.message).toContain(uiText("session_loop_scheduled"))
    expect(pane.commands.notice?.message).toContain(uiText("session_loop_last_result", { result: uiText("session_loop_run_failed") }))
    expect(pane.draft().content).toBe("")
    expect(agentClient.sendMessage).not.toHaveBeenCalled()
    expect(agentClient.execute).not.toHaveBeenCalled()
  })

  it("stops a scheduled loop in a running Session and retains a newer draft", async () => {
    const response = deferred<SessionLoopStatus>()
    vi.mocked(agentClient.applySessionLoop).mockReturnValueOnce(response.promise)
    const pane = await mount({ running: true })
    await pane.write("/loop stop")
    expect(await pane.submit()).toBe("handled")
    expect(agentClient.applySessionLoop).toHaveBeenCalledExactlyOnceWith(mainId, { action: "stop" })

    await pane.write("keep this newer draft")
    await settleChat(() => response.resolve({
      session_id: mainId, loop: { state: "stopped", next_fire_at: null, last_run_status: null },
    }))
    expect(pane.commands.notice?.message).toBe(uiText("session_loop_stopped"))
    expect(pane.draft().content).toBe("keep this newer draft")
    expect(agentClient.sendMessage).not.toHaveBeenCalled()
    expect(agentClient.execute).not.toHaveBeenCalled()
  })

  it("starts an adaptive loop while a run is active and retains a failed draft", async () => {
    vi.mocked(agentClient.applySessionLoop).mockRejectedValueOnce(new Error("No adaptive acknowledgement"))
      .mockResolvedValueOnce({
        session_id: mainId, loop: { mode: "adaptive", state: "scheduled", next_fire_at: null, last_run_status: null },
      })
    const pane = await mount({ running: true })
    const command = "/loop 检查部署\nKeep  spacing"
    await pane.write(command)
    expect(await pane.submit()).toBe("handled")
    expect(pane.draft().content).toBe(command)
    expect(pane.commands.notice?.message).toBe(uiText("session_loop_unconfirmed"))

    expect(await pane.submit()).toBe("handled")
    expect(agentClient.applySessionLoop).toHaveBeenCalledTimes(2)
    expect(agentClient.applySessionLoop).toHaveBeenLastCalledWith(mainId, {
      action: "start_adaptive", prompt: "检查部署\nKeep  spacing",
    })
    expect(pane.commands.notice?.message).toBe(uiText("session_loop_adaptive_scheduled"))
    expect(pane.draft().content).toBe("")
    expect(agentClient.sendMessage).not.toHaveBeenCalled()
  })

  it("allows status and stop in Ultra while keeping start and resume in Standard", async () => {
    const pane = await mount({ thinkingMode: "ultra" })
    for (const action of ["status", "stop"] as const) {
      await pane.write(`/loop ${action}`)
      expect(await pane.submit()).toBe("handled")
      expect(agentClient.applySessionLoop).toHaveBeenLastCalledWith(mainId, { action })
      expect(pane.draft().content).toBe("")
    }
    for (const command of ["/loop 5m check", "/loop check the build", "/loop resume"]) {
      await pane.write(command)
      expect(await pane.submit()).toBe("handled")
      expect(pane.commands.notice?.message).toBe(uiText("session_loop_standard_only"))
      expect(pane.draft().content).toBe(command)
    }
    expect(agentClient.applySessionLoop).toHaveBeenCalledTimes(2)
    expect(agentClient.sendMessage).not.toHaveBeenCalled()
    expect(agentClient.execute).not.toHaveBeenCalled()
  })

  it.each([
    ["/loop 5m check", { action: "start", interval_seconds: 300, prompt: "check" }],
    ["/loop 每隔五分钟检查构建", { action: "status" }],
  ] as const)("keeps %s out of ordinary chat when the backend lacks loop support", async (prompt, action) => {
    vi.mocked(agentClient.applySessionLoop).mockRejectedValueOnce(new ApiError("not found", 404, "Not Found"))
    const pane = await mount()
    await pane.write(prompt)
    expect(await pane.submit()).toBe("handled")
    expect(agentClient.applySessionLoop).toHaveBeenCalledExactlyOnceWith(mainId, action)
    expect(pane.commands.notice).toMatchObject({ error: true, message: uiText("session_loop_backend_unavailable") })
    expect(pane.draft().content).toBe(prompt)
    expect(agentClient.sendMessage).not.toHaveBeenCalled()
    expect(agentClient.execute).not.toHaveBeenCalled()
  })

  it("passes natural /loop text intact to ordinary admission after a successful status probe", async () => {
    const pane = await mount()
    const prompt = "/loop 每隔五分钟检查构建"
    await pane.write(prompt)
    expect(await pane.submit()).toBe("pass")
    expect(agentClient.applySessionLoop).toHaveBeenCalledExactlyOnceWith(mainId, { action: "status" })
    expect(pane.draft().content).toBe(prompt)
    expect(agentClient.sendMessage).not.toHaveBeenCalled()
  })

  it.each(["edit", "navigation", "running"] as const)("rechecks %s after confirming a spoken /loop", async (change) => {
    const status = deferred<SessionLoopStatus>()
    vi.mocked(agentClient.applySessionLoop).mockReturnValueOnce(status.promise)
    const pane = await mount()
    const prompt = "/loop 每隔五分钟检查构建"
    await pane.write(prompt)
    const submitting = pane.submit()
    expect(agentClient.applySessionLoop).toHaveBeenCalledExactlyOnceWith(mainId, { action: "status" })
    if (change === "edit") await pane.write("newer draft")
    if (change === "navigation") {
      await pane.rebind(otherId)
      await pane.rebind(mainId)
    }
    if (change === "running") await pane.setRunning(true)
    await settleChat(() => status.resolve({ session_id: mainId, loop: null }))
    expect(await submitting).toBe("handled")
    expect(pane.draft().content).toBe(change === "edit" ? "newer draft" : prompt)
    expect(agentClient.sendMessage).not.toHaveBeenCalled()
  })

  it.each([
    "/loop every five minutes check the build",
    "/loop check the build every 90 seconds",
    "/loop 每隔九十秒检查构建",
    "/loop 5 minutes between checks",
    "/loop 恢复这个循环。",
    "/loop when will this loop run next?",
  ])("keeps natural request %s local until the busy session finishes", async (prompt) => {
    const pane = await mount({ running: true })
    await pane.write(prompt)
    expect(await pane.submit()).toBe("handled")
    expect(agentClient.applySessionLoop).not.toHaveBeenCalled()
    expect(pane.commands.notice?.message).toBe(uiText("session_loop_wait_for_session"))
    expect(pane.draft().content).toBe(prompt)
    expect(agentClient.sendMessage).not.toHaveBeenCalled()
  })

  it.each(["/loop", "/loop 30s check", "/loop 1.5h check", "/loop stop extra", "/loop stop! extra"])(
    "keeps malformed fixed syntax %s local even in a running session", async (command) => {
      const pane = await mount({ running: true })
      await pane.write(command)
      expect(await pane.submit()).toBe("handled")
      expect(agentClient.applySessionLoop).not.toHaveBeenCalled()
      expect(pane.commands.notice?.message).toBe(uiText("session_loop_usage"))
      expect(pane.draft().content).toBe(command)
      expect(agentClient.sendMessage).not.toHaveBeenCalled()
    },
  )
})

describe("Solid manual compaction command", () => {
  type Pane = Awaited<ReturnType<typeof mount>>
  const submit = (pane: Pane) => settleChat(() => { expect(pane.commands.handleCompact(pane.draft())).toBe(true) })

  it("dispatches one compaction request and leaves a newer draft intact", async () => {
    const receipt = deferred<SessionCompactionReceipt>()
    vi.mocked(agentClient.compactSessionContext).mockReturnValueOnce(receipt.promise)
    const pane = await mount()
    await pane.write(" /COMPACT  ")
    await settleChat(() => {
      expect(pane.commands.handleCompact(pane.draft())).toBe(true)
      expect(pane.commands.handleCompact(pane.draft())).toBe(true)
    })
    expect(agentClient.compactSessionContext).toHaveBeenCalledExactlyOnceWith(mainId)
    expect(pane.commands.compactPending).toBe(true)
    expect(agentClient.sendMessage).not.toHaveBeenCalled()
    expect(agentClient.execute).not.toHaveBeenCalled()

    await pane.write("new message")
    await settleChat(() => receipt.resolve({
      session_id: mainId, status: "compacted", usage_before_percent: 73, usage_after_percent: 24.5,
      token_usage: { total_tokens: 24500, max_context_tokens: 100000, system_tokens: 500, summary_tokens: 500,
        window_tokens: 23500, budget_limit: 96000, truncation_occurred: false, segments_removed: 0 },
    }))
    expect(pane.commands.compactPending).toBe(false)
    expect(pane.draft().content).toBe("new message")
    expect(appStore.getState().loadChatHistory).toHaveBeenCalledExactlyOnceWith(mainId, { mode: "monotonic" })
    expect(appStore.getState().tokenUsages[mainId]).toMatchObject({ totalTokens: 24500, maxContextTokens: 100000 })
    expect(pane.commands.notice?.message).toBe(uiText("compact_context_applied", { before: "73", after: "24.5" }))
  })

  it("preserves the draft if the backend compact route is unavailable", async () => {
    vi.mocked(agentClient.compactSessionContext).mockRejectedValueOnce(new ApiError("not found", 404, "Not Found"))
    const pane = await mount()
    await pane.write("/compact")
    await submit(pane)
    expect(agentClient.compactSessionContext).toHaveBeenCalledExactlyOnceWith(mainId)
    expect(pane.commands.notice).toMatchObject({ error: true, message: uiText("compact_context_not_found") })
    expect(pane.draft().content).toBe("/compact")
    expect(agentClient.sendMessage).not.toHaveBeenCalled()
  })

  it.each(["running", "attachment"] as const)("keeps /compact local when blocked by %s", async (block) => {
    const pane = await mount({ running: block === "running", attachments: block === "attachment" })
    await pane.write("/compact")
    await submit(pane)
    const reason = uiText(block === "running" ? "compact_wait_for_session" : "compact_send_alone")
    expect(pane.commands.compactUnavailable).toBe(reason)
    expect(pane.commands.notice?.message).toBe(reason)
    expect(agentClient.compactSessionContext).not.toHaveBeenCalled()
    expect(agentClient.sendMessage).not.toHaveBeenCalled()
    expect(pane.draft().content).toBe("/compact")
  })

  it.each(["child", "managed", "supervisor"] as const)("blocks compaction for a known %s session", async (kind) => {
    const fixture = currentUserManagedSessionsFixture()
    const target = fixture.sessions[0]!.current_user_target!
    const id = kind === "supervisor" ? DEFAULT_SUPERVISOR_SESSION_ID : kind === "managed" ? target.session_id : mainId
    appStore.setState({ chats: [{ ...session(id), kind: kind === "child" ? "child" : "root" }] })
    if (kind === "managed") {
      appStore.setState({ managedHistoryBindings: { [id]: { status: "active", selection: { supervisor: fixture.scope.supervisor, target } } } })
    }
    const pane = await mount({ sessionId: id })
    await pane.write("/compact")
    await submit(pane)
    expect(agentClient.compactSessionContext).not.toHaveBeenCalled()
    expect(agentClient.sendMessage).not.toHaveBeenCalled()
    expect(pane.draft().content).toBe("/compact")
    expect(pane.commands.compactUnavailable).toBe(uiText("compact_root_only"))
  })

  it("keeps compaction feedback and draft clearing scoped to the originating Session", async () => {
    const receipt = deferred<SessionCompactionReceipt>()
    vi.mocked(agentClient.compactSessionContext).mockReturnValueOnce(receipt.promise)
    const pane = await mount()
    await pane.write("/compact")
    await submit(pane)
    expect(agentClient.compactSessionContext).toHaveBeenCalledExactlyOnceWith(mainId)

    await pane.rebind(otherId)
    await pane.write("draft in other session")
    expect(pane.commands.compactPending).toBe(false)
    expect(await pane.submit()).toBe("pass")
    await settleChat(() => receipt.resolve({ session_id: mainId, status: "unchanged" }))
    expect(appStore.getState().getInputState(mainId).content).toBe("")
    expect(pane.draft().content).toBe("draft in other session")
    expect(pane.commands.notice).toBeNull()
  })
})
