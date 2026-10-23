import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { uiText } from "@shared/i18n/ui"
import { agentClient } from "@services/chat/AgentService"
import { ConversationClearDialog } from "./ConversationClearDialog"

const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
environment.IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => vi.restoreAllMocks())

describe("optional clear confirmation loading", () => {
  it.each([false, true])("allows cancellation without a mutation when loading failed=%s", async (failed) => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const clear = vi.spyOn(agentClient, "clearSession"), close = vi.fn()
    const container = document.body.appendChild(document.createElement("div")), root = createRoot(container)
    await act(async () => root.render(<ConversationClearDialog sessionId="synthetic" title="Synthetic" onClose={close}
      loadDialog={() => failed ? Promise.reject(new Error("synthetic loader failure")) : new Promise(() => {})} />))
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain(uiText(failed ? "conversation_clear_load_failed" : "loading_4927a53b"))
    await act(async () => [...dialog.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === uiText("cancel_2cd0f3be"))!.click())
    expect(close).toHaveBeenCalledTimes(1)
    expect(clear).not.toHaveBeenCalled()
    act(() => root.unmount()); container.remove()
  })
})
