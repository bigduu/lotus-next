import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { uiText } from "@shared/i18n/ui"
import { useAppStore } from "@shared/store/appStore"
import { agentClient, type SessionSummary } from "@services/chat/AgentService"
import { ApiError, NetworkRequestError } from "@services/api/errors"
import { sessionSummaryToChatItem } from "@shared/store/appStore/slices/chatSessionSlice/messageMapping"
import { ConversationClearDialog } from "./ConversationClearDialog"
import { SessionRow } from "./SessionRow"
import { SupervisorEntry } from "@/components/app/SupervisorEntry"
import { SectionSessions } from "./settings/system/SectionSessions"

const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
environment.IS_REACT_ACT_ENVIRONMENT = true
const original = useAppStore.getState()
const id = "fixture/a"
const summary = { id, kind: "root", title: "Synthetic conversation", title_version: 1, pinned: false,
  root_session_id: id, spawn_depth: 0, model: "fixture", created_at: "2026-10-22T00:00:00Z",
  updated_at: "2026-10-22T00:00:00Z", last_activity_at: "2026-10-22T00:00:00Z",
  is_running: false, message_count: 0, has_attachments: false, token_usage: null } as SessionSummary
let root: Root, container: HTMLDivElement
const close = vi.fn()
const render = (node: ReactNode) => act(() => root.render(node))
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === label)!
const click = async (label: string) => act(async () => button(label).click())
beforeEach(() => {
  container = document.body.appendChild(document.createElement("div")); root = createRoot(container)
  close.mockReset()
  useAppStore.setState({ ...original, chats: [sessionSummaryToChatItem(summary)], currentSessionId: id, conversationClears: {} })
  vi.spyOn(agentClient, "getSession").mockResolvedValue({ session: summary })
  vi.spyOn(agentClient, "getPendingQuestion").mockResolvedValue({ has_pending_question: false })
  vi.spyOn(agentClient, "getHistory").mockResolvedValue({ session_id: id, messages: [] })
  vi.spyOn(agentClient, "clearSession").mockResolvedValue(undefined)
})
afterEach(() => { act(() => root.unmount()); container.remove(); useAppStore.setState(original, true); vi.restoreAllMocks() })
const dialog = () => <ConversationClearDialog sessionId={id} title={summary.title} onClose={close} />

describe("shared conversation clear confirmation", () => {
  it("names the exact session and retained data; cancelling has no read or write side effect", async () => {
    render(dialog())
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(`${summary.title} · ${id}`)
    expect(document.body.textContent).toContain(uiText("conversation_clear_impact"))
    expect(document.body.textContent).toContain(uiText("conversation_clear_limits"))
    await click(uiText("cancel_2cd0f3be"))
    expect(close).toHaveBeenCalledTimes(1)
    expect(agentClient.getSession).not.toHaveBeenCalled()
    expect(agentClient.clearSession).not.toHaveBeenCalled()
  })

  it("reports success only after verification and allows closing without another mutation", async () => {
    render(dialog()); await click(uiText("conversation_clear_action"))
    expect(document.querySelector('[role="status"]')?.textContent).toBe(uiText("conversation_clear_confirmed"))
    expect(button(uiText("conversation_clear_action"))).toBeUndefined()
    await click(uiText("close_3fd47edc"))
    expect(useAppStore.getState().conversationClears[id]).toBeUndefined()
    expect(agentClient.clearSession).toHaveBeenCalledTimes(1)
  })

  it("keeps a readback failure visible and verifies by GET only", async () => {
    vi.mocked(agentClient.getHistory).mockRejectedValueOnce(new Error("unavailable"))
    render(dialog()); await click(uiText("conversation_clear_action"))
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(uiText("conversation_clear_readback_failed"))
    expect(document.querySelector('[role="status"]')).toBeNull()
    expect(button(uiText("conversation_clear_action"))).toBeUndefined()
    await click(uiText("conversation_clear_refresh"))
    expect(document.querySelector('[role="status"]')?.textContent).toBe(uiText("conversation_clear_confirmed"))
    expect(agentClient.clearSession).toHaveBeenCalledTimes(1)
  })

  it("keeps unknown locked across reopen, with explicit readback rather than repeated POST", async () => {
    vi.mocked(agentClient.clearSession).mockRejectedValueOnce(new NetworkRequestError())
    render(dialog()); await click(uiText("conversation_clear_action"))
    await click(uiText("close_3fd47edc")); render(null); render(dialog())
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(uiText("conversation_clear_unknown"))
    expect(button(uiText("conversation_clear_action"))).toBeUndefined()
    await click(uiText("conversation_clear_refresh"))
    expect(document.querySelector('[role="status"]')?.textContent).toBe(uiText("conversation_clear_readback_only"))
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(uiText("conversation_clear_unknown"))
    expect(agentClient.clearSession).toHaveBeenCalledTimes(1)
  })

  it("renders the activated-session refusal without promising a Supervisor reset", async () => {
    vi.mocked(agentClient.clearSession).mockRejectedValueOnce(new ApiError("fixture", 409, "Conflict", JSON.stringify({
      error: { code: "session_clear_authority_conflict" }, status: "blocked", retryable: false,
    })))
    render(dialog()); await click(uiText("conversation_clear_action"))
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(uiText("conversation_clear_authority_conflict"))
    expect(document.querySelector('[role="status"]')).toBeNull()
  })

  for (const entry of ["ordinary", "supervisor", "simple-settings"] as const) {
    it(`${entry} opens the same confirmation and cancellation sends no mutation`, async () => {
      const chat = sessionSummaryToChatItem(summary), action = vi.fn()
      render(entry === "ordinary" ? <SessionRow chat={chat} active onSelect={action} onRename={action}
        onDelete={action} onTogglePin={action} onCopySessionId={action} /> : entry === "supervisor"
        ? <SupervisorEntry chat={chat} active unread={false} busy={false} disabled={false} onSelect={action} onRename={action} />
        : <SectionSessions advanced={false} />)
      if (entry !== "simple-settings") {
        await act(async () => container.querySelector("button")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })))
        await act(async () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
          .find((node) => node.textContent?.trim() === uiText("conversation_clear_action"))!.click())
      } else {
        expect(document.body.textContent).not.toContain(uiText("delete_all_sessions_ddae77af"))
        expect(document.body.textContent).not.toContain(uiText("reset_session_storage_226dd63a"))
        await click(uiText("conversation_clear_action"))
      }
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain(uiText("conversation_clear_title"))
      await click(uiText("cancel_2cd0f3be"))
      expect(document.querySelector('[role="dialog"]')).toBeNull()
      expect(agentClient.clearSession).not.toHaveBeenCalled()
      expect(action).not.toHaveBeenCalled()
    })
  }
})
