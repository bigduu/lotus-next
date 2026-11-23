import { render } from "@solidjs/web"
import { createSignal, flush, For } from "solid-js"
import { expect, it, vi } from "vitest"
import { uiText } from "@shared/i18n/text"
import { mapHistoryMessagesToUi } from "@shared/store/appStore/slices/chatSessionSlice/messageMapping"
import type { ChatItem, Message } from "@shared/types/chatMessages"
import { transcriptWorkWait } from "../status/transcriptWorkWait"
import { RenderHistoryRow } from "./HistoryRow"
import { buildDisplayItems, buildLiveItems, buildRenderItems, renderItemKey } from "./historyProjection"

vi.mock("@lucide/solid", () => {
  const Icon = () => <svg aria-hidden="true" />
  return { Brain: Icon, ChevronRight: Icon, Terminal: Icon }
})

const sessionId = "runtime-notice-session"
const handle = "e9511561-7f99-4389-a7de-0c9e7a39ffe7"
const notice = {
  id: "runtime-wait-notice",
  role: "assistant" as const,
  phase: "final_answer" as const,
  content: `Moved command \`${handle}\` to background monitoring. You can continue this conversation; its result will return automatically.`,
  created_at: "2026-10-30T16:00:00Z",
  metadata: { runtime_kind: "background_exec_wait", source: "runtime", exec_session_id: handle },
}
const progressHistory = [
  { id: "build-user", role: "user" as const, content: "Build and check the artifact.", created_at: "2026-10-30T15:59:00Z" },
  { id: "build-progress", role: "assistant" as const, phase: "commentary" as const,
    content: "The build has started.", created_at: "2026-10-30T15:59:10Z" },
  { id: "read-command", role: "assistant" as const, content: "", created_at: "2026-10-30T15:59:20Z",
    tool_calls: [{ id: "read-output", type: "function", function: { name: "write_stdin", arguments: "{}" } }] },
  { id: "read-result", role: "tool" as const, tool_call_id: "read-output", content: "running", created_at: "2026-10-30T15:59:21Z" },
]
const final = {
  id: "build-final", role: "assistant" as const, phase: "final_answer" as const,
  content: "The artifact passed verification.", created_at: "2026-10-30T16:05:00Z",
}
const mapHistory = (history: Parameters<typeof mapHistoryMessagesToUi>[1]) => mapHistoryMessagesToUi(sessionId, history)
const savedNotice = () => mapHistory([notice])

function commandWait(messages: Message[], lastRunStatus: string) {
  const currentChat: ChatItem = {
    id: sessionId, title: "Build", createdAt: 0, messages, lastRunStatus, isRunning: false,
    config: { systemPromptId: "", baseSystemPrompt: "", lastUsedEnhancedPrompt: null },
  }
  return transcriptWorkWait({ currentChat, pendingQuestion: null, pendingApproval: null })
}

it("maps the exact backend runtime-notice metadata through history loading", () => {
  expect(savedNotice()[0]).toMatchObject({ id: notice.id, metadata: notice.metadata })
})

it.each([true, false])("displays a localized runtime notice with metadata=%s", (hasMetadata) => {
  const messages = mapHistory([{ ...notice, metadata: hasMetadata ? notice.metadata : undefined }])
  const item = buildRenderItems(messages)[0]!
  const host = document.createElement("div")
  const dispose = render(() => <RenderHistoryRow item={item} theme="light"
    disclosure={{ isOpen: () => false, toggle: () => {} }} onOpenLink={() => {}} onPreviewImage={() => {}} />, host)
  try {
    flush()
    const card = host.querySelector('[data-runtime-notice="background_exec_wait"]')
    expect(card?.textContent).toContain(uiText("runtime_notice_background_exec_title_1b8a7ef0"))
    expect(card?.textContent).toContain(handle)
    expect(host.textContent).not.toContain("Moved command")
    expect(host.textContent).not.toContain("background monitoring")
  } finally {
    dispose()
  }
})

it("presents the monitored command wait when the producer marks the session suspended", () => {
  expect(commandWait(savedNotice(), "suspended")).toMatchObject({ monitoredCommand: true, command: true, yielded: true })
})

it.each(["completed", "failed", "cancelled"])("suppresses a stale notice spinner after %s", (status) => {
  expect(commandWait(savedNotice(), status)).toMatchObject({ monitoredCommand: false, command: false, yielded: false })
})

it("withdraws the old wait when the history grows and retains the earlier notice", () => {
  const messages = mapHistory([notice, final])
  expect(commandWait(messages, "suspended").command).toBe(false)
  expect(buildRenderItems(messages).filter((item) => item.kind === "msg").map((item) => item.m.id))
    .toEqual([notice.id, final.id])
})

it.each(["final phase", "without phase", "after an interjection"] as const)("keeps previous progress visible while a runtime notice remains %s", (variant) => {
  const note = variant === "final phase" ? notice : { ...notice, phase: undefined,
    metadata: variant === "after an interjection" ? undefined : notice.metadata }
  const later = variant === "after an interjection"
    ? [{ id: "interjection", role: "user" as const, content: "What are you waiting for?", created_at: "2026-10-30T16:01:00Z" }]
    : []
  const messages = mapHistory([...progressHistory, note, ...later])
  const display = buildDisplayItems(buildRenderItems(messages), variant !== "final phase")
  expect(display.filter((item) => item.kind === "collapsedTurn")).toHaveLength(0)
  expect(display.filter((item) => item.kind === "msg").map((item) => item.m.id))
    .toEqual(["build-user", "build-progress", notice.id, ...later.map((item) => item.id)])
})

it("folds the activity only after the recorded final answer arrives", () => {
  const display = buildDisplayItems(buildRenderItems(mapHistory([...progressHistory, notice, final])), true)
  const folds = display.filter((item) => item.kind === "collapsedTurn")
  expect(folds).toHaveLength(1)
  expect(folds[0]?.key).toBe("collapsed-turn-build-final")
  expect(folds[0]?.items.filter((item) => item.kind === "msg").map((item) => item.m.id)).toEqual(["build-progress", notice.id])
  expect(display.at(-1)).toMatchObject({ kind: "msg", m: { id: final.id, content: final.content } })
})

it("shows a yielded parent waiting without thinking and restores thinking only during model work", () => {
  const yielded: ChatItem = { id: sessionId, title: "Parent", createdAt: 0, messages: [], isRunning: false,
    lastRunStatus: "suspended", activity: "waiting_children", runningChildCount: 1,
    config: { systemPromptId: "", baseSystemPrompt: "", lastUsedEnhancedPrompt: null } }
  const [session, setSession] = createSignal(yielded)
  const rows = () => {
    const currentChat = session()
    const wait = transcriptWorkWait({ currentChat, pendingQuestion: null, pendingApproval: null })
    return buildLiveItems([], null, null, currentChat.isRunning === true || wait.yielded,
      wait.delegationHint ? uiText("process_waiting_for_subagents") : null, uiText)
  }
  const host = document.createElement("div")
  const dispose = render(() => <For each={rows()} keyed={renderItemKey}>{(item) => <RenderHistoryRow live item={item()} theme="light"
    disclosure={{ isOpen: () => false, toggle: () => {} }} onOpenLink={() => {}} onPreviewImage={() => {}} />}</For>, host)
  try {
    flush()
    expect(host.querySelector('[role="status"]')?.textContent).toBe(uiText("process_waiting_for_subagents"))
    expect(host.querySelector("[data-process-shimmer], [data-process-toggle]")).toBeNull()

    setSession({ ...yielded, isRunning: true, lastRunStatus: "running", activity: undefined, runningChildCount: 0 })
    flush()
    expect(host.querySelector('[role="status"]')?.textContent).toBe(uiText("thinking_64088d8c"))
    expect(host.querySelector("[data-process-shimmer]")).not.toBeNull()

    setSession({ ...yielded, lastRunStatus: "completed", activity: undefined, runningChildCount: 0 })
    flush()
    expect(host.querySelector('[role="status"]')).toBeNull()
  } finally { dispose() }
})
