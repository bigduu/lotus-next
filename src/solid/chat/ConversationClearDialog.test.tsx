import { createSignal, flush, Show } from "solid-js"
import { render, type JSX } from "@solidjs/web"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { uiText } from "@shared/i18n/text"
import { appStore } from "@shared/store/appStore/state"
import { agentClient, type SessionSummary } from "@services/chat/AgentService"
import { ApiError, NetworkRequestError } from "@services/api/errors"
import { sessionSummaryToChatItem } from "@shared/store/appStore/slices/chatSessionSlice/messageMapping"
import { SessionMaintenanceSettings } from "../settings/system/MaintenanceSettings"
import { SessionRow } from "../shell/SessionRow"
import { SupervisorEntry } from "../shell/SupervisorEntry"
import { ConversationClearDialog } from "./ConversationClearDialog"
import { ConversationClearDialogContent } from "./ConversationClearDialogContent"

vi.mock("@lucide/solid", () => {
  const Icon = () => <svg aria-hidden="true" />
  const glyphs = ["AlertCircle", "AlertTriangle", "Check", "CircleDot", "Copy", "GitBranch", "GitMerge", "List",
    "MoreHorizontal", "Pencil", "Pin", "PinOff", "RotateCcw", "Sparkles", "Trash2", "X"]
  return Object.fromEntries(glyphs.map((name) => [name, Icon]))
})

// The desktop and touch tests exercise the native portaled primitives,
// including focus restoration. Keep only the shell boundaries local to JSDOM.
vi.mock("../ui/responsive-dialog", () => ({
  ResponsiveDialog: (props: { open?: boolean; children: JSX.Element }) =>
    <Show when={props.open}>{props.children}</Show>,
  ResponsiveDialogContent: (props: { children: JSX.Element }) => <div role="dialog">{props.children}</div>,
  ResponsiveDialogTitle: (props: { children: JSX.Element }) => <h2>{props.children}</h2>,
  ResponsiveDialogDescription: (props: { children: JSX.Element }) => <div>{props.children}</div>,
}))

vi.mock("../ui/dialog", () => {
  const Body = (props: { children: JSX.Element }) => props.children
  return {
    Dialog: (props: { open: boolean; children: JSX.Element }) => <Show when={props.open}>{props.children}</Show>,
    DialogContent: (props: { children: JSX.Element }) => <div role="dialog">{props.children}</div>,
    DialogDescription: Body, DialogFooter: Body, DialogHeader: Body, DialogTitle: Body,
  }
})

vi.mock("../ui/dropdown-menu", () => ({
  DropdownMenu: (props: { open: boolean; onOpenChange: (open: boolean) => void; children: JSX.Element }) =>
    <Show when={props.open}><div role="menu" onClick={() => props.onOpenChange(false)}>{props.children}</div></Show>,
  DropdownMenuContent: (props: { children: JSX.Element }) => <>{props.children}</>,
  DropdownMenuItem: (props: { disabled?: boolean; onSelect?: () => void; children: JSX.Element }) =>
    <button type="button" role="menuitem" disabled={props.disabled} onClick={() => props.onSelect?.()}>{props.children}</button>,
  DropdownMenuTrigger: () => null, DropdownMenuSub: () => null, DropdownMenuSubContent: () => null, DropdownMenuSubTrigger: () => null,
}))

const original = appStore.getState()
const id = "fixture/a"
const summary: SessionSummary = {
  id, kind: "root", title: "Synthetic conversation", title_version: 1, pinned: false,
  root_session_id: id, spawn_depth: 0, model: "fixture", created_at: "2026-10-22T00:00:00Z",
  updated_at: "2026-10-22T00:00:00Z", last_activity_at: "2026-10-22T00:00:00Z",
  is_running: false, message_count: 0, has_attachments: false,
}
const displayed = () => container.querySelector('[role="dialog"]')
const button = (label: string, within: ParentNode = container) => [...within.querySelectorAll<HTMLButtonElement>("button")]
  .find((node) => node.textContent?.trim() === label)
const schedule = setTimeout
let container: HTMLDivElement
let dispose: (() => void) | undefined
const close = vi.fn()
const chat = sessionSummaryToChatItem(summary)

async function settle() {
  await new Promise<void>((resolve) => schedule(resolve, 0))
  flush()
}

function mount(view: () => JSX.Element) {
  dispose = render(view, container)
  flush()
}

async function click(label: string, within: ParentNode = container) {
  const action = button(label, within)
  expect(action).toBeDefined()
  action!.click()
  await settle()
}

beforeEach(() => {
  container = document.body.appendChild(document.createElement("div"))
  close.mockReset()
  appStore.setState({ ...original, chats: [chat], currentSessionId: id, conversationClears: {} })
  vi.spyOn(agentClient, "getSession").mockResolvedValue({ session: summary })
  vi.spyOn(agentClient, "getPendingQuestion").mockResolvedValue({ has_pending_question: false })
  vi.spyOn(agentClient, "getHistory").mockResolvedValue({ session_id: id, messages: [] })
  vi.spyOn(agentClient, "clearSession").mockResolvedValue(undefined)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  container.remove()
  appStore.setState(original, true)
  vi.restoreAllMocks()
})

const dialog = () => <ConversationClearDialogContent sessionId={id} title={summary.title} onClose={close} />

describe("shared conversation clear confirmation", () => {
  it("names the exact session and retained data; cancelling has no read or write side effect", async () => {
    mount(dialog)
    expect(displayed()?.textContent).toContain(`${summary.title} · ${id}`)
    expect(container.textContent).toContain(uiText("conversation_clear_impact"))
    expect(container.textContent).toContain(uiText("conversation_clear_limits"))
    await click(uiText("cancel_2cd0f3be"))
    expect(close).toHaveBeenCalledTimes(1)
    expect(agentClient.getSession).not.toHaveBeenCalled()
    expect(agentClient.clearSession).not.toHaveBeenCalled()
  })

  it("reports success only after verification and allows closing without another mutation", async () => {
    let completeRead!: () => void
    vi.mocked(agentClient.getHistory).mockImplementationOnce(() => new Promise((resolve) => {
      completeRead = () => resolve({ session_id: id, messages: [] })
    }))
    mount(dialog)
    await click(uiText("conversation_clear_action"))
    await vi.waitFor(() => expect(completeRead).toBeDefined())
    expect(container.querySelector('[role="status"]')).toBeNull()
    expect(agentClient.clearSession).toHaveBeenCalledTimes(1)
    completeRead()
    await settle()
    expect(container.querySelector('[role="status"]')?.textContent).toBe(uiText("conversation_clear_confirmed"))
    expect(button(uiText("conversation_clear_action"))).toBeUndefined()
    await click(uiText("close_3fd47edc"))
    expect(appStore.getState().conversationClears[id]).toBeUndefined()
    expect(agentClient.clearSession).toHaveBeenCalledTimes(1)
  })

  it("keeps a readback failure visible and verifies by GET only", async () => {
    vi.mocked(agentClient.getHistory).mockRejectedValueOnce(new Error("unavailable"))
    mount(dialog)
    await click(uiText("conversation_clear_action"))
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(uiText("conversation_clear_readback_failed"))
    expect(container.querySelector('[role="status"]')).toBeNull()
    expect(button(uiText("conversation_clear_action"))).toBeUndefined()
    await click(uiText("conversation_clear_refresh"))
    expect(container.querySelector('[role="status"]')?.textContent).toBe(uiText("conversation_clear_confirmed"))
    expect(agentClient.clearSession).toHaveBeenCalledTimes(1)
  })

  it("keeps unknown locked across reopen, with explicit readback rather than repeated POST", async () => {
    vi.mocked(agentClient.clearSession).mockRejectedValueOnce(new NetworkRequestError())
    const [open, setOpen] = createSignal(true)
    mount(() => <Show when={open()}>
      <ConversationClearDialogContent sessionId={id} title={summary.title} onClose={() => setOpen(false)} />
    </Show>)
    await click(uiText("conversation_clear_action"))
    await click(uiText("close_3fd47edc"))
    expect(displayed()).toBeNull()
    setOpen(true)
    flush()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(uiText("conversation_clear_unknown"))
    expect(button(uiText("conversation_clear_action"))).toBeUndefined()
    await click(uiText("conversation_clear_refresh"))
    expect(container.querySelector('[role="status"]')?.textContent).toBe(uiText("conversation_clear_readback_only"))
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(uiText("conversation_clear_unknown"))
    expect(agentClient.clearSession).toHaveBeenCalledTimes(1)
  })

  it("renders the activated-session refusal without promising a Supervisor reset", async () => {
    vi.mocked(agentClient.clearSession).mockRejectedValueOnce(new ApiError("fixture", 409, "Conflict", JSON.stringify({
      error: { code: "session_clear_authority_conflict" }, status: "blocked", retryable: false,
    })))
    mount(dialog)
    await click(uiText("conversation_clear_action"))
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(uiText("conversation_clear_authority_conflict"))
    expect(container.querySelector('[role="status"]')).toBeNull()
  })

  for (const entry of ["ordinary", "supervisor", "simple-settings"] as const) {
    it(`${entry} opens the same confirmation and cancellation sends no mutation`, async () => {
      const action = vi.fn()
      const [target, setTarget] = createSignal<typeof chat>()
      mount(() => <>
        {entry === "ordinary" ? <SessionRow chat={chat} active unread={false} onSelect={action} onRename={action}
          onDelete={action} onTogglePin={action} onCopySessionId={action} onRegenerateTitle={action} onClear={() => setTarget(chat)} />
          : entry === "supervisor" ? <SupervisorEntry chat={chat} active unread={false} running={false} busy={false} disabled={false}
            onSelect={action} onRename={action} onClear={setTarget} />
          : <SessionMaintenanceSettings advanced={false} />}
        <Show when={target()} keyed>{(session) =>
          <ConversationClearDialog sessionId={session.id} title={session.title} onClose={() => setTarget(undefined)} />
        }</Show>
      </>)
      if (entry !== "simple-settings") {
        container.querySelector("button")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))
        flush()
        const menu = container.querySelector('[role="menu"]')!
        expect(menu).not.toBeNull()
        await click(uiText("conversation_clear_action"), menu)
      } else {
        expect(container.textContent).not.toContain(uiText("delete_all_sessions_ddae77af"))
        expect(container.textContent).not.toContain(uiText("reset_session_storage_226dd63a"))
        await click(uiText("conversation_clear_action"))
      }
      await vi.waitFor(() => {
        flush()
        expect(displayed()?.textContent).toContain(`${summary.title} · ${id}`)
      })
      expect(displayed()?.textContent).toContain(uiText("conversation_clear_title"))
      await click(uiText("cancel_2cd0f3be"))
      expect(displayed()).toBeNull()
      expect(agentClient.clearSession).not.toHaveBeenCalled()
      expect(action).not.toHaveBeenCalled()
    })
  }
})

describe("optional clear confirmation loading", () => {
  it.each([false, true])("allows cancellation without a mutation when loading failed=%s", async (failed) => {
    const load = vi.fn(() => failed ? Promise.reject(new Error("synthetic loader failure")) : new Promise<never>(() => {}))
    mount(() => <ConversationClearDialog sessionId={id} title={summary.title} onClose={close} loadDialog={load} />)
    await settle()
    expect(displayed()?.textContent).toContain(uiText(failed ? "conversation_clear_load_failed" : "loading_4927a53b"))
    await click(uiText("cancel_2cd0f3be"), displayed()!)
    expect(close).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledOnce()
    expect(agentClient.getSession).not.toHaveBeenCalled()
    expect(agentClient.clearSession).not.toHaveBeenCalled()
  })
})
