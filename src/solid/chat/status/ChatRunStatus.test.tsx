import { render } from "@solidjs/web"
import { createSignal, flush, For } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"
import { currentUserManagedSessionsFixture } from "@services/supervisorScope/testFixtures"
import { uiText } from "@shared/i18n/text"
import { appStore } from "@shared/store/appStore/state"
import type { ChatItem } from "@shared/types/chatMessages"
import { createRunInteractionTimeline, RunInteractions } from "../RunInteractions"
import type { createChat, GenerationFailure } from "../createChat"
import { ChatRunStatus } from "./ChatRunStatus"

vi.mock("@kobalte/core/dialog", async () => (await import("../../test/compiledKobalte")).compiledKobalte("dialog"))
vi.mock("@lucide/solid", () => ({ AlertTriangle: () => null, RotateCcw: () => null, ShieldAlert: () => null, X: () => null }))

type Chat = ReturnType<typeof createChat>
type Inputs = Pick<Chat, "pendingQuestion" | "pendingApproval" | "sendFailure">
  & { currentChat: ChatItem }
const from = "11111111-1111-4111-8111-111111111111"
const to = "22222222-2222-4222-8222-222222222222"
const oldDiagnostic = "9ab6cd70-bc43-4fed-9f10-50c2873fa287"
const newDiagnostic = "fa6aa794-30d4-4e8b-a222-46b35c8348d9"
const failureDetail = "Automatic retry time budget exhausted"
const generationFailure = {
  kind: "generation-failed", operationId: 4, sessionId: from, message: failureDetail,
} satisfies GenerationFailure

const compatible = {
  blocked: false, observed: true, loading: false, legacy: false, readError: false,
  report: null, refresh: vi.fn(async () => {}),
} satisfies Chat["executionCompatibility"]
const childApproval = {
  childSessionId: "waiting-child", requestId: "pending-child-approval", toolName: "Write", permission: "write",
} satisfies Chat["pendingApproval"]
const question = {
  has_pending_question: true, interaction_kind: "clarification", question: "Keep going?",
  options: ["Yes"], allow_custom: false, tool_call_id: "pending-root-question", permission_request: null,
} satisfies Chat["pendingQuestion"]

function session(id: string, status: string, error?: string): ChatItem {
  return {
    id, kind: "root", title: "Fixture session", createdAt: 1, messages: [], lastRunStatus: status, lastRunError: error,
    config: { systemPromptId: "", baseSystemPrompt: "", lastUsedEnhancedPrompt: null },
  }
}

const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })

function mount(currentChat: ChatItem, pending: Partial<Inputs> = {}) {
  const [inputs, setInputs] = createSignal<Inputs>({
    currentChat, pendingQuestion: null, pendingApproval: null, sendFailure: null, ...pending,
  })
  const retry = vi.fn(async (_failure?: GenerationFailure) => {})
  const send = vi.fn()
  const fetch = vi.fn()
  const continueEditing = vi.fn()
  vi.stubGlobal("fetch", fetch)
  const ports: Partial<Chat> = {
    get currentChat() { return inputs().currentChat },
    get currentSessionId() { return inputs().currentChat.id },
    get sendFailure() { return inputs().sendFailure },
    get pendingQuestion() { return inputs().pendingQuestion },
    get pendingApproval() { return inputs().pendingApproval },
    executionCompatibility: compatible, approvalCompatibility: compatible, messages: [],
    sending: false, streaming: null, retry, send,
  }
  const chat = ports as Chat
  const host = document.body.appendChild(document.createElement("div"))
  const dispose = render(() => {
    const timeline = createRunInteractionTimeline({ chat, workspace: () => null })
    return <>
      <For each={timeline()} keyed={(entry) => entry.key}>{(entry) => <>{entry().render()}</>}</For>
      <RunInteractions chat={chat} />
      <ChatRunStatus chat={chat} onContinueEditing={continueEditing} />
    </>
  }, host)
  cleanups.push(() => { dispose(); host.remove() })
  flush()
  return {
    host, retry, send, fetch, continueEditing,
    update(next: Partial<Inputs>) {
      setInputs((previous) => ({ ...previous, ...next }))
      flush()
    },
  }
}

const button = (host: ParentNode, label: Parameters<typeof uiText>[0]) =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find((element) => element.textContent?.trim() === uiText(label))
const openDialog = () => document.querySelector('[role="dialog"][data-state="open"]')
const alert = (host: ParentNode) => host.querySelector('[role="alert"]')

async function openDiagnostic(host: HTMLElement) {
  button(host, "run_diagnostics_open")!.click()
  flush()
  return vi.waitFor(() => JSON.parse(openDialog()!.querySelector("pre")!.textContent!))
}

it("asks for refresh and reselect only when the currently managed session goes stale", () => {
  const fixture = currentUserManagedSessionsFixture()
  const selection = { supervisor: fixture.scope.supervisor, target: fixture.sessions[0]!.current_user_target! }
  const managed = selection.target.session_id
  const previous = appStore.getState().managedHistoryBindings
  cleanups.push(() => appStore.setState({ managedHistoryBindings: previous }))
  appStore.setState({ managedHistoryBindings: { [managed]: { selection, status: "active" } } })
  const view = mount(session(managed, "completed"))
  expect(alert(view.host)).toBeNull()
  appStore.setState({ managedHistoryBindings: { [managed]: { selection, status: "stale" } } })
  flush()
  expect(alert(view.host)?.textContent).toBe(uiText("supervisor_managed_history_stale"))
  expect(alert(view.host)?.classList.contains("text-destructive")).toBe(true)
  view.update({ currentChat: session(to, "completed") })
  expect(alert(view.host)).toBeNull()
  expect(view.fetch).not.toHaveBeenCalled()
})

it("keeps legacy technical details while exporting no invented retry limit or raw error", async () => {
  const view = mount(session(from, "error", "legacy upstream error after 1 request(s)."))
  expect(view.host.querySelector("details summary")?.textContent).toBe(uiText("technical_details_c26fb419"))
  expect(view.host.querySelector("details")?.textContent).toContain("legacy upstream error after 1 request(s).")
  const report = await openDiagnostic(view.host)
  expect(report.diagnostic).toMatchObject({ diagnostic_id: null, attempt: null, attempt_limit: null })
  expect(JSON.stringify(report)).not.toContain("legacy upstream")
  expect(view.retry).not.toHaveBeenCalled()
  expect(view.send).not.toHaveBeenCalled()
  expect(view.fetch).not.toHaveBeenCalled()
})

it.each([
  ["question", { pendingQuestion: question }, () => openDialog(), question.question],
  ["child approval", { pendingApproval: childApproval }, () => document.querySelector("[data-approval-presentation]"), childApproval.toolName],
] as const)("puts a pending %s ahead of earlier diagnostic recovery", (_kind, pending, interaction, copy) => {
  const view = mount(session(from, "suspended"), { ...pending, sendFailure: generationFailure })
  expect(interaction()?.textContent).toContain(copy)
  expect(alert(view.host)?.textContent ?? "").not.toContain(failureDetail)
  expect(button(view.host, "run_diagnostics_open")).toBeUndefined()
  expect(button(view.host, "retry_generation_37960b38")).toBeUndefined()
  expect(view.retry).not.toHaveBeenCalled()

  view.update({ pendingQuestion: null, pendingApproval: null })
  expect(interaction()).toBeNull()
  expect(alert(view.host)?.textContent).toContain(failureDetail)
  expect(button(view.host, "run_diagnostics_open")).toBeDefined()
  button(view.host, "retry_generation_37960b38")!.click()
  expect(view.retry).toHaveBeenCalledExactlyOnceWith(generationFailure)
})

it.each([
  ["pending-question recovery", { activity: "waiting_user" }],
  ["Plan approval", { planMode: { status: "awaiting_approval", entered_at: "2026-01-01T00:00:00Z",
    pre_permission_mode: "default" } }],
] as const)("holds an earlier saved failure during %s", (_label, currentWait) => {
  const current = session(from, "error", failureDetail)
  const view = mount({ ...current, ...currentWait })
  expect(alert(view.host)).toBeNull()
  expect(view.retry).not.toHaveBeenCalled()
  view.update({ currentChat: current })
  expect(alert(view.host)?.textContent).toContain(failureDetail)
})

it("keeps draft recovery visible during an independent pending interaction", () => {
  const view = mount({ ...session(from, "suspended"), activity: "waiting_user" }, {
    sendFailure: { kind: "submission-unconfirmed", operationId: 4, sessionId: from, message: "Submission did not complete" },
  })
  expect(alert(view.host)?.textContent).toContain("Submission did not complete")
  expect(alert(view.host)?.textContent).toContain(uiText("continue_editing_fd4b9e3b"))
  button(view.host, "continue_editing_fd4b9e3b")!.click()
  expect(view.continueEditing).toHaveBeenCalledTimes(1)
  expect(view.retry).not.toHaveBeenCalled()
  expect(view.send).not.toHaveBeenCalled()
})

it.each([
  ["Budget error: compression stream closed before response.completed", "message_sent_but_generation_was_interrupted_62a4d83d", null],
  ["Stream timed out: phase=bootstrap, deadline_ms=120000, last_http_status=429, retry_delay_ms=60000",
    "model_service_rate_limited_8b54cf50", "the_provider_or_proxy_returned_429_wait_for_the_rate_li_b76133d9"],
  ["Stream timed out: phase=bootstrap, deadline_ms=120000, last_semantic_ms_ago=never",
    "model_service_connection_timed_out_ecde837c", "the_model_response_could_not_be_established_check_the_p_c6ee27c5"],
  ["Tool error: Execution failed: Native canonical Session Source scope changed",
    "session_source_changed", "session_source_changed_action"],
] as const)("preserves guidance and actionable retry after loading %s", (detail, title, action) => {
  const view = mount(session(from, "error", detail))
  const notice = alert(view.host)!
  expect(notice.textContent).toContain(uiText(title))
  if (action) expect(notice.textContent).toContain(uiText(action))
  expect(notice.querySelector("details")?.open).toBe(false)
  expect(notice.querySelector("details")?.textContent).toContain(detail)
  expect(button(view.host, "run_diagnostics_open")).toBeDefined()
  expect(button(view.host, "upstream_retry_until_stopped")).toBeUndefined()
  expect(view.retry).not.toHaveBeenCalled()
  button(view.host, "retry_generation_37960b38")!.click()
  expect(view.retry).toHaveBeenCalledExactlyOnceWith(undefined)
  expect(view.send).not.toHaveBeenCalled()
})

it.each([
  ["LLM error: HTTP 429: model_cooldown", "model_service_rate_limited_8b54cf50"],
  ["Tool error: Execution failed: Native canonical Session Source scope changed", "session_source_changed"],
] as const)("retries a scoped live error %s without replaying its message", (message, title) => {
  const failure = { ...generationFailure, message }
  const view = mount(session(from, "completed"), { sendFailure: failure })
  expect(alert(view.host)?.textContent).toContain(uiText(title))
  expect(alert(view.host)?.querySelector("details")?.textContent).toContain(message)
  expect(view.retry).not.toHaveBeenCalled()
  button(view.host, "retry_generation_37960b38")!.click()
  expect(view.retry).toHaveBeenCalledExactlyOnceWith(failure)
  expect(view.send).not.toHaveBeenCalled()
})

it("closes an old preview on navigation and binds the next preview to its own saved error", async () => {
  const view = mount(session(from, "error", "PRIVATE_OLD_ERROR. Diagnostic ID: " + oldDiagnostic + "."))
  expect((await openDiagnostic(view.host)).diagnostic.diagnostic_id).toBe(oldDiagnostic)
  view.update({ currentChat: session(to, "error", "Diagnostic ID: " + newDiagnostic + "."),
    sendFailure: { kind: "generation-failed", operationId: 1, sessionId: from, message: "Diagnostic ID: " + oldDiagnostic + "." } })
  expect(openDialog()).toBeNull()
  const report = await openDiagnostic(view.host)
  expect(report.context.session_id).toBe(to)
  expect(report.diagnostic.diagnostic_id).toBe(newDiagnostic)
  expect(openDialog()?.textContent).not.toContain(oldDiagnostic)
  expect(view.retry).not.toHaveBeenCalled()
  expect(view.send).not.toHaveBeenCalled()
  expect(view.fetch).not.toHaveBeenCalled()
})
