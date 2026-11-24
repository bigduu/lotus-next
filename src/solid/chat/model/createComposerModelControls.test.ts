import { createRoot, createSignal, flush } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"
import { DEFAULT_SUPERVISOR_SESSION_ID } from "@/lib/supervisor"
import { agentClient } from "@services/chat/AgentService"
import { clearSessionCompatibilityObservations, readSessionExecutionDetail } from "@services/chat/sessionExecutionCompatibility"
import type { ChatItem } from "@shared/types/chatMessages"
import type { createChat } from "../createChat"
import { createComposerModelControls } from "./createComposerModelControls"
import { createRootModeAuthority } from "./createRootModeAuthority"

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  clearSessionCompatibilityObservations()
  vi.restoreAllMocks()
})

it("keeps saved Work effort after a title update and binds it to its recorded lifetime", async () => {
  const id = `ticket-${"a".repeat(32)}`
  const createdAt = "2026-11-19T00:00:00Z"
  const chat: ChatItem = {
    id, kind: "child", title: "Work", createdAt: Date.parse(createdAt), createdAtExact: createdAt, updatedAt: createdAt,
    messages: [], config: { systemPromptId: "", baseSystemPrompt: "", lastUsedEnhancedPrompt: null, reasoningEffort: "low" },
  }
  const read = vi.spyOn(agentClient, "getSession").mockResolvedValue({ session: {
    id, kind: "child", parent_session_id: DEFAULT_SUPERVISOR_SESSION_ID, created_at: createdAt, reasoning_effort: "max",
  } } as Awaited<ReturnType<typeof agentClient.getSession>>)
  const [current, setCurrent] = createSignal(chat)
  const pane = createRoot((cleanup) => {
    dispose = cleanup
    type Chat = ReturnType<typeof createChat>
    const ports: Partial<Chat> = {
      currentSessionId: id,
      get currentChat() { return current() },
      executionCompatibility: {
        blocked: false, observed: true, legacy: true, loading: false, readError: false, report: null, refresh: async () => {},
      },
    }
    const root = createRootModeAuthority(() => id, () => current().kind)
    return createComposerModelControls({ chat: ports as Chat, draftKey: () => id, disabled: () => false, root })
  })
  flush()
  expect(pane.thinking.ordinaryValue).toBe("low")
  expect(read).not.toHaveBeenCalled()

  await readSessionExecutionDetail(id)
  flush()
  expect(pane.thinking.ordinaryValue).toBe("max")
  setCurrent({ ...chat, title: "Renamed Work", updatedAt: "2026-11-19T00:01:00Z" })
  flush()
  expect(pane.thinking.ordinaryValue).toBe("max")
  expect(read).toHaveBeenCalledExactlyOnceWith(id)

  setCurrent({ ...chat, createdAtExact: "2026-11-19T00:02:00Z" })
  flush()
  expect(pane.thinking.ordinaryValue).toBe("low")
})
