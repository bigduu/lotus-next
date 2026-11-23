import { createEffect, createRoot, createSignal } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { agentClient, type ChatResponse, type SessionCompactionReceipt } from "@services/chat/AgentService"
import { ApiError } from "@services/api/errors"
import { clearSessionCompatibilityObservations, observeSessionExecutionConflict } from "@services/chat/sessionExecutionCompatibility"
import { appStore } from "@shared/store/appStore/state"
import type { ChatItem } from "@shared/types/chatMessages"
import type { SkillDefinition } from "@shared/types/skill"
import { uiText } from "@shared/i18n/text"
import { beginRootModeOperation } from "@/lib/rootModeTransitionState"
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

async function mount(options: { newChat?: boolean; attachments?: boolean; running?: boolean } = {}) {
  const initial = options.newChat ? null : mainId
  const [id, setId] = createSignal<string | null>(initial)
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
      running: () => options.running === true, blocked: () => false, hasAttachments: () => options.attachments === true,
      queueBusy: () => false, queuePending: () => false, thinkingMode: () => "standard", openGoal, openWorkflowRuns,
    })
    createEffect(() => model.slashQuery, (query) => { observedMenus.push(query) })
    return model
  })
  await settleChat()
  return {
    commands, draft, openGoal, openWorkflowRuns, observedMenus,
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
