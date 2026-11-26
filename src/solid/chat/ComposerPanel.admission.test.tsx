import { flush } from "solid-js"
import { render, type ComponentProps } from "@solidjs/web"
import { afterEach, expect, it, vi } from "vitest"
import { appStore } from "@shared/store/appStore/state"
import { ComposerPanel } from "./ComposerPanel"
import { createGuidanceQueue } from "./guidance/createGuidanceQueue"
import { createRootModeAuthority } from "./model/createRootModeAuthority"
import { createTicketIngress } from "./createTicketIngress"
import type { SendSubmissionResult } from "./createChat"

vi.mock("@kobalte/core/select", async () => (await import("../test/compiledKobalte")).compiledKobalte("select"))
vi.mock("@kobalte/core/dialog", async () => (await import("../test/compiledKobalte")).compiledKobalte("dialog"))
vi.mock("@kobalte/core/popover", async () => (await import("../test/compiledKobalte")).compiledKobalte("popover"))
vi.mock("@kobalte/core/dropdown-menu", async () => (await import("../test/compiledKobalte")).compiledKobalte("dropdown-menu"))
vi.mock("../composer/ComposerEditor", () => ({ ComposerEditor: () => null }))
vi.mock("@services/chat/liveBootstrapRetry", async (original) => ({
  ...await original<typeof import("@services/chat/liveBootstrapRetry")>(),
  readLiveBootstrapCapability: async () => null,
}))
vi.mock("@lucide/solid", () => {
  const Icon = () => <svg aria-hidden="true" />
  return {
    AlertCircle: Icon, ArrowUp: Icon, BookText: Icon, Check: Icon, ChevronDown: Icon, ChevronLeft: Icon,
    ChevronRight: Icon, Circle: Icon, Ellipsis: Icon, FolderClosed: Icon, FolderGit2: Icon, GitBranch: Icon,
    Info: Icon, LoaderCircle: Icon, Paperclip: Icon, RefreshCw: Icon, RotateCcw: Icon, Search: Icon,
    ShieldAlert: Icon, Sparkles: Icon, Square: Icon, X: Icon,
  }
})

const draft = ""
const splitDraft = "__new_chat_pane2__"
const newSession = "new-root"
let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
  appStore.setState(appStore.getInitialState(), true)
  localStorage.clear()
  vi.unstubAllGlobals()
})

function mountComposer() {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  })
  const host = document.body.appendChild(document.createElement("div"))
  let acknowledge!: (result: SendSubmissionResult) => void
  const response = new Promise<SendSubmissionResult>((resolve) => { acknowledge = resolve })
  type Chat = ComponentProps<typeof ComposerPanel>["chat"]
  const send = vi.fn<Chat["send"]>().mockReturnValue(response)
  const port: Partial<Chat> = {
    booted: true, currentSessionId: null, currentChat: null, messages: [], sending: false, streaming: null,
    pendingApproval: null, pendingQuestion: null, submissionPending: false, contextCompression: null,
    executionCompatibility: {
      blocked: false, observed: false, legacy: false, loading: false, readError: false, report: null, refresh: async () => {},
    },
    send,
  }
  dispose = render(() => {
    const rootAuthority = createRootModeAuthority(() => null, () => undefined)
    const ingress = createTicketIngress(() => null, () => false)
    const guidanceQueue = createGuidanceQueue(() => null, () => false)
    return <ComposerPanel chat={port as Chat} running={false} guidanceQueue={guidanceQueue}
      rootAuthority={rootAuthority} ingress={ingress}
      workspacePath={null} projectId={null} selectedWorktreePath={null} draftEpoch={0}
      navigationVersion={() => 0} semantic={false} draftRecoveryMode="ordinary" reference={null} canSendIngress={false}
      onSelectProject={() => {}} captureSessionCreated={() => () => {}} onOpenWorkspacePicker={() => {}}
      onOpenGoal={() => {}} onOpenWorkflowRuns={() => {}} onClearReference={() => {}} onPreviewImage={() => {}} />
  }, host)
  flush()
  return {
    send,
    async submit() {
      const button = host.querySelector<HTMLButtonElement>('button[aria-label="发送消息"]')
      expect(button?.disabled).toBe(false)
      button!.click()
      flush()
      await vi.waitFor(() => expect(send).toHaveBeenCalledOnce())
    },
    async accept() {
      acknowledge({ kind: "accepted", operationId: 1, sessionId: newSession, navigated: true })
      await response
      flush()
      await vi.waitFor(() => expect(host.querySelector('[aria-label="发送中"]')).toBeNull())
    },
  }
}

it.each(["standard", "ultra"] as const)(
  "freezes a new %s Root choice and clears only its acknowledged draft revision",
  async (thinkingMode) => {
    const { setInputContent, setInputThinkingMode, setInputReasoningEffort, getInputState } = appStore.getState()
    setInputContent(draft, "new root")
    setInputThinkingMode(draft, thinkingMode)
    setInputReasoningEffort(draft, "max")
    setInputContent(splitDraft, "keep split")
    setInputThinkingMode(splitDraft, "ultra")
    const split = getInputState(splitDraft)
    const composer = mountComposer()
    await composer.submit()
    expect(composer.send).toHaveBeenCalledExactlyOnceWith("new root", expect.objectContaining({
      thinkingMode, rootOrchestrationOnly: thinkingMode === "ultra", reasoningSelection: "max",
    }))

    await composer.accept()
    expect(getInputState(draft)).toMatchObject({ content: "" })
    expect(getInputState(draft).thinkingMode).toBeUndefined()
    expect(getInputState(draft).reasoningEffort).toBeUndefined()
    expect(getInputState(splitDraft)).toBe(split)
    expect(getInputState(newSession).thinkingMode).toBeUndefined()
  },
)

it.each(["standard", "ultra"] as const)("preserves a newer %s choice through a late Root ACK", async (newMode) => {
  const { setInputContent, setInputThinkingMode, getInputState } = appStore.getState()
  setInputContent(draft, "submitted")
  setInputThinkingMode(draft, "ultra")
  const submitted = getInputState(draft).thinkingModeRevision
  const composer = mountComposer()
  await composer.submit()

  setInputThinkingMode(draft, newMode)
  setInputContent(draft, "newer draft")
  const latest = getInputState(draft).thinkingModeRevision
  expect(latest).not.toBe(submitted)
  await composer.accept()
  expect(getInputState(draft).thinkingMode).toBe(newMode)
  expect(getInputState(draft).thinkingModeRevision).toBe(latest)
  expect(getInputState(newSession).content).toBe("newer draft")
  expect(getInputState(newSession).thinkingMode).toBeUndefined()
})
