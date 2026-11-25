import { beforeEach, describe, expect, it, vi } from "vitest"
import { apiClient } from "@services/api"
import { ApiError } from "@services/api/errors"
import { agentClient, type ChatResponse, type TruncateSessionMessagesResponse } from "@services/chat/AgentService"
import { appStore } from "@shared/store/appStore/state"
import { providerStore } from "@shared/store/appStore/slices/providerState"
import { getUsedModels } from "@shared/utils/usedModels"
import { beginRootModeOperation, getRootModeFenceState } from "@/lib/rootModeTransitionState"
import { peekPendingTemplatePrompt, setPendingTemplatePrompt } from "@/lib/taskTemplates"
import type { SendSubmissionResult } from "./createChat"
import { settleChat } from "./chatInteractionTestHarness"
import { deferred, feedSessions, history, savedSession, session, useChatStreamFixture } from "./chatStreamTestHarness"

vi.mock("@shared/store/appStore/state", async (original) => ({
  ...await original<typeof import("@shared/store/appStore/state")>(),
  initializeStore: vi.fn(async () => {}),
}))

const mount = useChatStreamFixture()
const model = "test-model"
const modelRef = { provider: "test-provider", model }
const providerSnapshot = () => providerStore.getState().providerSnapshot!
const submit = () => vi.mocked(agentClient.sendMessage)
const ack = (id: string): ChatResponse => ({ session_id: id, status: "success" })
const fenceRoot = (enabled = false) => beginRootModeOperation("root-session", 0, "a".repeat(64), enabled)

function offerTemplate(text: string) {
  setPendingTemplatePrompt(text)
  return peekPendingTemplatePrompt()!
}

beforeEach(() => {
  setPendingTemplatePrompt(null)
  appStore.setState({ selectedModel: modelRef })
  providerStore.setState({ ...providerStore.getInitialState(), providerSnapshot: {
    default_provider_instance_id: modelRef.provider,
    instances: [{ id: modelRef.provider, type: "openai", label: "Test", enabled: true, config: { runtime_models: [model] } }],
    defaults: { chat: modelRef },
  } }, true)
  vi.spyOn(appStore.getState(), "selectSession")
  vi.spyOn(appStore.getState(), "updateSession")
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("Solid send admission and Root mode", () => {
  it("submits and executes a non-default provider's custom model before catalog metadata loads", async () => {
    const customRef = { provider: "other-provider", model: "vendor:custom-name" }
    providerSnapshot().instances.push({
      id: customRef.provider, type: "openai", label: "Other", enabled: true,
      config: { runtime_models: [customRef.model] },
    })
    appStore.setState({ selectedModel: customRef })
    submit().mockResolvedValueOnce(ack("custom-session"))
    const pane = await mount(null)

    await settleChat(async () => { await pane.chat.send("use the admitted custom model") })

    expect(providerStore.getState().catalog).toBeNull()
    expect(submit()).toHaveBeenCalledWith(expect.objectContaining({ model: customRef.model, model_ref: customRef }))
    expect(agentClient.execute).toHaveBeenCalledWith("custom-session", customRef.model, undefined, undefined, customRef)
  })

  it.each([["custom-model", "custom-model"], ["foreign-cached-model", "test-model"]])("uses saved instance admission without role defaults for selected %s", async (selected, expectedModel) => {
    const snapshot = providerSnapshot()
    snapshot.defaults = undefined
    snapshot.features = { provider_model_ref: false }
    snapshot.instances[0].config.model = "test-model"
    snapshot.instances[0].config.runtime_models = ["test-model", "custom-model"]
    appStore.setState({ selectedModel: { provider: "test-provider", model: selected } })
    submit().mockResolvedValueOnce(ack("instance-only-session"))
    const pane = await mount(null)
    await settleChat(async () => { await pane.chat.send("start from the first provider") })
    const expectedRef = { provider: "test-provider", model: expectedModel }
    expect(submit()).toHaveBeenCalledWith(expect.objectContaining({ model: expectedModel, model_ref: expectedRef }))
    expect(agentClient.execute).toHaveBeenCalledWith("instance-only-session", expectedModel, undefined, undefined, expectedRef)
  })

  it("revalidates a disabled draft provider at submission and freezes the fallback for execute", async () => {
    const snapshot = providerSnapshot()
    snapshot.instances.push({ id: "second-provider", type: "openai", label: "Second", enabled: true, config: { runtime_models: ["second-default"] } })
    const response = deferred<ChatResponse>()
    submit().mockReturnValueOnce(response.promise)
    const pane = await mount(null)
    const cachedSend = pane.chat.send
    snapshot.instances[0].enabled = false
    snapshot.defaults = { chat: { provider: "second-provider", model: "second-default" } }
    providerStore.setState({ providerSnapshot: { ...snapshot } })
    const sending = cachedSend("use the newly configured provider")
    const expectedRef = { provider: "second-provider", model: "second-default" }
    expect(submit()).toHaveBeenCalledWith(expect.objectContaining({ model: expectedRef.model, model_ref: expectedRef }))

    // A later preference change must not reroute the acknowledged session.
    snapshot.instances[0].enabled = true
    snapshot.defaults = { chat: { provider: "test-provider", model: "test-model" } }
    providerStore.setState({ providerSnapshot: { ...snapshot } })
    await pane.rebind(null)
    await settleChat(async () => { response.resolve(ack("switched-session")); await sending })
    expect(agentClient.execute).toHaveBeenCalledWith("switched-session", expectedRef.model, undefined, undefined, expectedRef)
  })

  it.each(["empty", "disabled", "missing"] as const)("blocks a new chat when saved admission is %s", async (mode) => {
    if (mode === "empty") providerSnapshot().instances[0].config.runtime_models = []
    if (mode === "disabled") providerSnapshot().instances[0].enabled = false
    if (mode === "missing") providerStore.setState({ providerSnapshot: null })
    const pane = await mount(null)
    let result!: SendSubmissionResult
    await settleChat(async () => { result = await pane.chat.send("no eligible runtime model") })
    expect(result).toEqual({ kind: "blocked" })
    expect(submit()).not.toHaveBeenCalled()
    expect(agentClient.execute).not.toHaveBeenCalled()
  })

  it.each([true, false])("blocks inline mode selection %s on an existing Root", async (selection) => {
    feedSessions([session("root-session")])
    const pane = await mount("root-session")
    let outcome: SendSubmissionResult | undefined
    await settleChat(async () => { outcome = await pane.chat.send("coordinate children", { rootOrchestrationOnly: selection }) })
    expect(outcome).toEqual({ kind: "blocked" })
    expect(submit()).not.toHaveBeenCalled()
  })

  it.each([true, false, undefined])("forwards a new Root creation choice %s", async (selection) => {
    submit().mockRejectedValueOnce(new Error("admission failed"))
    const pane = await mount(null)
    await settleChat(async () => { await pane.chat.send("coordinate children", { rootOrchestrationOnly: selection }) })
    expect(submit()).toHaveBeenCalledWith(expect.objectContaining({
      session_id: undefined,
      root_orchestration_only: selection,
      thinking_mode: selection === undefined ? undefined : selection ? "ultra" : "standard",
    }))
  })

  it.each(["ultra", "standard"] as const)("submits product mode %s independently of ordinary Max", async (thinkingMode) => {
    submit().mockRejectedValueOnce(new Error("admission failed"))
    const pane = await mount(null)
    await settleChat(async () => { await pane.chat.send("coordinate", { thinkingMode, reasoningSelection: "max" }) })
    expect(submit()).toHaveBeenCalledWith(expect.objectContaining({
      thinking_mode: thinkingMode, root_orchestration_only: thinkingMode === "ultra", reasoning_effort: "max",
    }))
  })

  it("keeps Auto inherited for Ultra and leaves unspecified admission unchanged", async () => {
    submit().mockRejectedValue(new Error("admission failed"))
    const pane = await mount(null)
    await settleChat(async () => { await pane.chat.send("coordinate", { thinkingMode: "ultra", reasoningSelection: "auto" }) })
    expect(submit().mock.calls[0][0]).toMatchObject({ thinking_mode: "ultra", root_orchestration_only: true })
    expect(submit().mock.calls[0][0].reasoning_effort).toBeUndefined()
    await settleChat(async () => { await pane.chat.send("default admission") })
    const request = JSON.parse(JSON.stringify(submit().mock.calls[1][0]))
    expect(request).not.toHaveProperty("thinking_mode")
    expect(request).not.toHaveProperty("root_orchestration_only")
  })

  it.each([
    { thinkingMode: "ultra", rootOrchestrationOnly: false },
    { thinkingMode: "standard", rootOrchestrationOnly: true },
    { thinkingMode: "max" }, { thinkingMode: null },
  ])("blocks invalid/contradictory first-chat selection %j", async (opts) => {
    const pane = await mount(null)
    let outcome: SendSubmissionResult | undefined
    await settleChat(async () => { outcome = await pane.chat.send("coordinate", opts as never) })
    expect(outcome).toEqual({ kind: "blocked" })
    expect(submit()).not.toHaveBeenCalled()
  })

  it.each(["standard", "ultra"] as const)("blocks existing-Root selector %s", async (thinkingMode) => {
    feedSessions([session("root-session")])
    const pane = await mount("root-session")
    let outcome: SendSubmissionResult | undefined
    await settleChat(async () => { outcome = await pane.chat.send("coordinate", { thinkingMode }) })
    expect(outcome).toEqual({ kind: "blocked" })
    expect(submit()).not.toHaveBeenCalled()
  })

  it("classifies a typed new-Root creation rejection without a mode-operation fence", async () => {
    submit().mockRejectedValueOnce(new ApiError(
      "Root orchestration-only mode conflicts with an active PlanMode",
      409,
      "Conflict",
      JSON.stringify({ error: { code: "root_orchestration_incompatible_mode" } }),
    ))
    const pane = await mount(null)
    let result: Awaited<ReturnType<typeof pane.chat.send>> | undefined
    await settleChat(async () => { result = await pane.chat.send("switch mode", { rootOrchestrationOnly: true }) })

    expect(result).toEqual({ kind: "unconfirmed", operationId: 1, rejectionCode: "root_orchestration_incompatible_mode" })
    expect(pane.chat.sendFailure).toMatchObject({
      kind: "submission-unconfirmed",
      rejectionCode: "root_orchestration_incompatible_mode",
      message: "Root orchestration-only mode conflicts with an active PlanMode",
    })
    expect(localStorage.length).toBe(0)
  })

  it("labels a typed Skill conflict without claiming the request changed Root mode", async () => {
    feedSessions([session("root-session")])
    submit().mockRejectedValueOnce(new ApiError(
      "Selected Skill conflicts with active Root mode", 409, "Conflict",
      JSON.stringify({ error: { code: "root_orchestration_incompatible_mode" } }),
    ))
    const pane = await mount("root-session")
    await settleChat(async () => { await pane.chat.send("use selected Skill", { skillIds: ["skill-a"] }) })
    expect(pane.chat.sendFailure).toMatchObject({
      kind: "submission-unconfirmed",
      rejectionCode: "root_orchestration_incompatible_mode",
      rootModeSelectionSubmitted: false,
    })
    expect(getRootModeFenceState("root-session")).toBe("clear")
  })

  it.each([409, 400, 500])("keeps a Source admission conflict unaccepted without changing the old source (HTTP %s)", async (status) => {
    const config = { model: "test-model", workspacePath: "/synthetic/original", projectId: "original-project" }
    const existing = session("old-source")
    feedSessions([{ ...existing, config: { ...existing.config, ...config } }])
    submit().mockRejectedValueOnce(new ApiError(
      "A running or starting session cannot change Project or Workspace", status, "Conflict",
      JSON.stringify({ error: { type: "api_error", code: "session_project_running_conflict" }, session_id: "old-source" }),
    ))
    const pane = await mount("old-source")
    await settleChat(async () => {
      expect(await pane.chat.send("Keep the unsent draft", { workspacePath: "/synthetic/other", projectId: "other-project" })).toMatchObject({ kind: "unconfirmed" })
    })
    expect(submit()).toHaveBeenCalledOnce()
    expect(submit().mock.calls[0][0]).toMatchObject({ session_id: "old-source", workspace_path: undefined, project_id: undefined })
    const failure = pane.chat.sendFailure
    expect(failure?.kind === "submission-unconfirmed" ? failure.rejectionCode : undefined).toBe(status === 409 ? "session_project_running_conflict" : undefined)
    if (status === 409) expect(pane.chat.sendFailure).toMatchObject({ rootModeSelectionSubmitted: false })
    expect(savedSession("old-source").config).toMatchObject({ model: "test-model", workspacePath: "/synthetic/original", projectId: "original-project" })
    expect(pane.chat.submissionPending).toBe(false)
    expect(pane.chat.sending).toBe(false)
    await settleChat(async () => { await pane.chat.retry() })
    expect(agentClient.execute).not.toHaveBeenCalled()
    expect(appStore.getState().updateSession).not.toHaveBeenCalled()
    expect(apiClient.post).not.toHaveBeenCalled()
    expect(getRootModeFenceState("old-source")).toBe("clear")
  })

  it("blocks omitted sends after a mode-only operation is fenced across remount", async () => {
    feedSessions([session("root-session")])
    expect(fenceRoot(false)).not.toBeNull()
    const pane = await mount("root-session")
    let outcome: SendSubmissionResult | undefined
    await settleChat(async () => { outcome = await pane.chat.send("continue without boolean") })
    expect(outcome).toEqual({ kind: "blocked" })
    expect(getRootModeFenceState("root-session")).toBe("uncertain")
    expect(submit()).not.toHaveBeenCalled()
    expect(agentClient.execute).not.toHaveBeenCalled()

    pane.unmount()
    const restored = await mount("root-session")
    await settleChat(async () => { outcome = await restored.chat.send("retry after reload", { rootOrchestrationOnly: true }) })
    expect(outcome).toEqual({ kind: "blocked" })
    expect(submit()).not.toHaveBeenCalled()
  })

  it("does not execute a rerun when a mode fence appears during preparation", async () => {
    feedSessions([session("root-session")])
    const preparation = deferred<TruncateSessionMessagesResponse>()
    vi.mocked(agentClient.truncateSessionMessages).mockReturnValueOnce(preparation.promise)
    const pane = await mount("root-session")
    const rerun = pane.chat.regenerate()
    expect(vi.mocked(agentClient.truncateSessionMessages)).toHaveBeenCalledTimes(1)
    expect(fenceRoot(false)).not.toBeNull()
    preparation.resolve({ success: true, session_id: "root-session", messages_removed: 0, message_count: 0 })
    await settleChat(async () => { await rerun })
    expect(agentClient.execute).not.toHaveBeenCalled()
  })

  it("keeps an acknowledged message but does not execute it after another tab fences the Session", async () => {
    feedSessions([session("root-session")])
    const acknowledgement = deferred<ChatResponse>()
    submit().mockReturnValueOnce(acknowledgement.promise)
    const pane = await mount("root-session")
    const sending = pane.chat.send("accepted ordinary message")
    expect(submit()).toHaveBeenCalledTimes(1)
    expect(fenceRoot(false)).not.toBeNull()
    acknowledgement.resolve(ack("root-session"))
    let outcome: SendSubmissionResult | undefined
    await settleChat(async () => { outcome = await sending; await Promise.resolve() })
    expect(outcome).toMatchObject({ kind: "accepted", sessionId: "root-session" })
    expect(agentClient.execute).not.toHaveBeenCalled()
    expect(pane.chat.sendFailure).toMatchObject({
      kind: "generation-failed", message: expect.stringContaining("消息已保存"),
    })
    expect(history()).toHaveBeenCalledWith("root-session", { mode: "monotonic" })
  })

  it("does not start detached execution after another tab fences an acknowledged Session", async () => {
    feedSessions([session("root-session")])
    const acknowledgement = deferred<ChatResponse>()
    submit().mockReturnValueOnce(acknowledgement.promise)
    const pane = await mount("root-session")
    const sending = pane.chat.send("accepted while leaving")
    await pane.rebind("other-session")
    expect(fenceRoot(false)).not.toBeNull()
    acknowledgement.resolve(ack("root-session"))
    await settleChat(async () => { expect((await sending).kind).toBe("accepted") })
    expect(agentClient.execute).not.toHaveBeenCalled()
    await pane.rebind("root-session")
    expect(pane.chat.sendFailure).toMatchObject({
      kind: "generation-failed", message: expect.stringContaining("消息已保存"),
    })
  })

  it("records the selected model only after the submission is acknowledged", async () => {
    const acknowledgement = deferred<ChatResponse>()
    submit().mockReturnValueOnce(acknowledgement.promise)
    const pane = await mount(null)
    const sending = pane.chat.send("remember this model")
    expect(getUsedModels()).toEqual([])
    await settleChat(async () => {
      acknowledgement.resolve(ack("used-model-session"))
      await expect(sending).resolves.toMatchObject({ kind: "accepted" })
    })
    expect(getUsedModels()).toEqual(["test-model"])
  })
  it("acknowledges the exact template lease only after a valid submission acknowledgement", async () => {
    const templatePrompt = offerTemplate("Use the exact template")
    appStore.setState({ lastSelectedPromptId: "general_assistant", systemPrompts: [{
      id: "general_assistant", name: "General assistant",
      content: "You are the selected Bodhi assistant.",
      isDefault: true,
    }] })
    submit()
      .mockRejectedValueOnce(new Error("submission not acknowledged"))
      .mockResolvedValueOnce(ack("template-session"))
    const pane = await mount(null)
    await settleChat(async () => {
      await pane.chat.send("first attempt", { templatePrompt })
    })
    expect(peekPendingTemplatePrompt()).toBe(templatePrompt)
    let accepted: SendSubmissionResult | undefined
    await settleChat(async () => {
      accepted = await pane.chat.send("second attempt", { templatePrompt })
    })
    expect(accepted).toMatchObject({ kind: "accepted", sessionId: "template-session" })
    expect(peekPendingTemplatePrompt()).toBeNull()
    expect(submit()).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        system_prompt:
          "You are the selected Bodhi assistant.\n\n## Task Mode\nUse the exact template",
      }),
    )
  })
  it("keeps the default prompt when a task template is selected without an explicit preset", async () => {
    const templatePrompt = offerTemplate("Investigate the reported failure.")
    appStore.setState({ systemPrompts: [
      { id: "custom", name: "Custom", content: "Custom prompt" },
      { id: "general_assistant", name: "General assistant", content: "Default Bodhi prompt", isDefault: true },
    ] })
    submit().mockResolvedValueOnce(ack("default-template-session"))
    const pane = await mount(null)

    await settleChat(async () => {
      await pane.chat.send("start investigation", { templatePrompt })
    })

    expect(submit()).toHaveBeenCalledWith(
      expect.objectContaining({
        system_prompt:
          "Default Bodhi prompt\n\n## Task Mode\nInvestigate the reported failure.",
      }),
    )
  })
  it("commits an acknowledged template and starts generation after the submitting pane unmounts", async () => {
    const acknowledgement = deferred<ChatResponse>()
    const templatePrompt = offerTemplate("Detached template")
    submit().mockReturnValueOnce(acknowledgement.promise)
    const pane = await mount(null)
    const sending = pane.chat.send("accepted while leaving", { templatePrompt })
    pane.unmount()
    let result: SendSubmissionResult | undefined
    await settleChat(async () => {
      acknowledgement.resolve(ack("detached-session"))
      result = await sending
    })
    expect(result).toMatchObject({
      kind: "accepted",
      sessionId: "detached-session",
      navigated: false,
    })
    expect(peekPendingTemplatePrompt()).toBeNull()
    expect(agentClient.execute).toHaveBeenCalledTimes(1)
    expect(agentClient.execute).toHaveBeenCalledWith("detached-session", "test-model", undefined, undefined, { provider: "test-provider", model: "test-model" })
    expect(vi.mocked(agentClient.subscribeToEvents)).not.toHaveBeenCalled()
    expect(appStore.getState().selectSession).not.toHaveBeenCalled()
  })
  it.each([
    ["a blank new chat", null],
    ["another session", "session-b"],
  ] as const)("detaches the old UI stream when navigating to %s", async (_label, destination) => {
    appStore.setState({ currentSessionId: "session-a" })
    feedSessions([{ ...session("session-a"), isRunning: true }])
    submit().mockResolvedValueOnce(ack("session-a"))
    let controller: AbortController | undefined
    vi.mocked(agentClient.subscribeToEvents).mockImplementationOnce(
      (_sessionId, _handlers, nextController) => {
        controller = nextController
        return new Promise<void>((resolve) => {
          nextController?.signal.addEventListener("abort", () => resolve(), { once: true })
        })
      },
    )
    const pane = await mount()
    await settleChat(async () => {
      await pane.chat.send("keep running in session A")
    })
    expect(pane.chat.sending).toBe(true)
    expect(pane.chat.streaming).toBe("")

    await settleChat(async () => {
      if (destination === null) pane.chat.newChat()
      else pane.chat.select(destination)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(controller?.signal.aborted).toBe(true)
    expect(agentClient.stopGeneration).not.toHaveBeenCalled()
    expect(appStore.getState().selectSession).toHaveBeenLastCalledWith(destination)
    if (destination !== null) {
      expect(history()).toHaveBeenCalledWith(destination, { throwOnError: true })
    }
    expect(pane.chat.currentSessionId).toBe(destination)
    expect(pane.chat.sending).toBe(false)
    expect(pane.chat.streaming).toBeNull()
  })

  it.each([
    [undefined, undefined],
    ["max", "max"],
    ["none", "none"],
  ] as const)(
    "maps a new-session Chat reasoning preference %s without resolving provider defaults",
    async (configuredEffort, expectedWireEffort) => {
      appStore.setState({ selectedModel: undefined })
      providerStore.setState({ providerSnapshot: {
        default_provider_instance_id: "instance-openai",
        instances: [{
          id: "instance-openai",
          type: "openai",
          label: "Easycli",
          enabled: true,
          // Deliberately differs from Auto: the new composer must not turn
          // this inherited provider value into an explicit picker override.
          config: { reasoning_effort: "high" },
        }],
        defaults: {
          chat: {
            provider: "instance-openai",
            model: "gpt-5.6-sol",
            ...(configuredEffort ? { reasoning_effort: configuredEffort } : {}),
          },
        },
        features: { provider_model_ref: true },
      } })
      submit().mockResolvedValueOnce(ack("new-reasoning-session"))

      const pane = await mount(null)
      await settleChat(async () => {
        await pane.chat.send("start with configured reasoning")
      })

      const request = submit().mock.calls[0][0]
      expect(request.reasoning_effort).toBe(expectedWireEffort)
      const serialized = JSON.parse(JSON.stringify(request)) as Record<string, unknown>
      if (expectedWireEffort === undefined) {
        expect(serialized).not.toHaveProperty("reasoning_effort")
      } else {
        expect(serialized.reasoning_effort).toBe(expectedWireEffort)
      }
      expect(agentClient.execute).toHaveBeenCalledWith(
        "new-reasoning-session",
        "gpt-5.6-sol",
        expectedWireEffort,
        undefined,
        { provider: "instance-openai", model: "gpt-5.6-sol" },
      )
    },
  )
  it.each([
    ["auto", undefined],
    ["max", "max"],
    ["none", "none"],
  ] as const)(
    "uses a bound blank pane's frozen picker value %s for chat and execute",
    async (selection, expectedWireEffort) => {
      appStore.setState({ selectedModel: undefined })
      providerStore.setState({ providerSnapshot: {
        default_provider_instance_id: "instance-openai",
        instances: [{
          id: "instance-openai",
          type: "openai",
          label: "Easycli",
          enabled: true,
          config: {},
        }],
        defaults: {
          chat: {
            provider: "instance-openai",
            model: "gpt-5.6-sol",
            reasoning_effort: "medium",
          },
        },
        features: { provider_model_ref: true },
      } })
      submit().mockResolvedValueOnce(ack("new-split-session"))

      const pane = await mount(null)
      await settleChat(async () => {
        await pane.chat.send("start from split pane", {
          reasoningSelection: selection,
        })
      })

      expect(submit().mock.calls[0][0].reasoning_effort).toBe(expectedWireEffort)
      expect(agentClient.execute).toHaveBeenCalledWith(
        "new-split-session",
        "gpt-5.6-sol",
        expectedWireEffort,
        undefined,
        { provider: "instance-openai", model: "gpt-5.6-sol" },
      )
    },
  )
  it("uses the authoritative Chat preference instead of the compatibility provider", async () => {
    appStore.setState({ selectedModel: undefined })
    providerStore.setState({ providerSnapshot: {
      default_provider_instance_id: "compatibility-openai",
      instances: [
        {
          id: "compatibility-openai",
          type: "openai",
          label: "Compatibility OpenAI",
          enabled: true,
          config: { reasoning_effort: "low" },
        },
        {
          id: "instance-openai",
          type: "openai",
          label: "Primary OpenAI",
          enabled: true,
          config: { reasoning_effort: "max" },
        },
      ],
      defaults: {
        chat: {
          provider: "instance-openai",
          model: "gpt-authoritative",
          reasoning_effort: "max",
        },
      },
      features: { provider_model_ref: true },
    } })
    const existing = session("provider-session")
    feedSessions([{ ...existing, config: { ...existing.config, model: undefined, reasoningEffort: "max" } }])
    submit().mockResolvedValueOnce(ack("provider-session"))

    const pane = await mount("provider-session")
    await settleChat(async () => {
      await pane.chat.send("use provider defaults")
    })

    expect(submit()).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: "provider-session",
        model: "gpt-authoritative",
        model_ref: { provider: "instance-openai", model: "gpt-authoritative" },
      }),
    )
    expect(agentClient.execute).toHaveBeenCalledWith(
      "provider-session",
      "gpt-authoritative",
      "max",
      undefined,
      { provider: "instance-openai", model: "gpt-authoritative" },
    )
  })
  it("keeps an existing child session bound to its own provider and model", async () => {
    const sessionId = "child-session"
    // A draft selected in another pane must not override this bound session.
    appStore.setState({ selectedModel: { provider: "test-provider", model: "grok-4.7" } })
    const existing = session(sessionId)
    feedSessions([{ ...existing, kind: "child", rootSessionId: "parent-session", parentSessionId: "parent-session",
      config: { ...existing.config,
        model: "gpt-5.6-luna",
        model_ref: { provider: "easycli", model: "gpt-5.6-luna" },
      },
    }])
    providerStore.setState({ providerSnapshot: {
      default_provider_instance_id: "easycli",
      instances: [{
        id: "easycli",
        type: "openai",
        label: "Easycli",
        enabled: true,
        config: { reasoning_effort: "max" },
      }],
      defaults: {
        chat: { provider: "easycli", model: "gpt-5.6-sol" },
      },
      features: { provider_model_ref: true },
    } })
    submit().mockResolvedValueOnce(ack(sessionId))

    const pane = await mount(sessionId)
    await settleChat(async () => {
      await pane.chat.send("continue child task")
    })

    expect(submit()).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: sessionId,
        root_orchestration_only: undefined,
        thinking_mode: undefined,
        model: "gpt-5.6-luna",
        model_ref: { provider: "easycli", model: "gpt-5.6-luna" },
      }),
    )
    expect(agentClient.execute).toHaveBeenCalledWith(
      sessionId,
      "gpt-5.6-luna",
      "max",
      undefined,
      { provider: "easycli", model: "gpt-5.6-luna" },
    )
  })
})
