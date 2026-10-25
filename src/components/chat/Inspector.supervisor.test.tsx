import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { useAppStore } from "@shared/store/appStore"
import type { ChatItem } from "@shared/types/chatMessages"
import { Inspector } from "./Inspector"
vi.mock("./ActorSnapshotPanel", () => ({ ActorSnapshotPanel: ({ active }: { active: boolean }) => <div data-testid="actor-view" data-active={String(active)} /> }))
vi.mock("./SupervisorManagedSessions", () => ({ SupervisorManagedSessionsPanel: () => <div data-testid="managed-view" /> }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const roots: Root[] = []
const initial = useAppStore.getState()
afterEach(() => { for (const root of roots.splice(0)) act(() => root.unmount()); useAppStore.setState(initial, true); document.body.replaceChildren() })
function renderSession(chat: Omit<ChatItem, "config" | "createdAt">) {
  useAppStore.setState({ chats: [{ ...chat, createdAt: 0, config: { systemPromptId: "", baseSystemPrompt: "", lastUsedEnhancedPrompt: null } }], currentSessionId: chat.id, loadTaskList: vi.fn().mockResolvedValue(undefined) })
  const root = createRoot(document.body.appendChild(document.createElement("div"))); roots.push(root)
  act(() => root.render(<Inspector embedded open sessionId={chat.id} onClose={() => {}} onCopySessionId={() => {}} />))
}
it("places managed sessions first and keeps Supervisor Child topology collapsed and inactive", () => {
  renderSession({ id: "bamboo-default-supervisor", title: "Bodhi", kind: "root", messages: [] })
  const managed = document.querySelector('[data-testid="managed-view"]')!
  const details = document.querySelector<HTMLDetailsElement>('[data-testid="supervisor-auxiliary-agents"]')!
  expect(managed.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
  expect(details.open).toBe(false); expect(details.querySelector('[data-testid="actor-view"]')?.getAttribute("data-active")).toBe("false")
  act(() => { details.open = true; details.dispatchEvent(new Event("toggle")) })
  expect(details.querySelector('[data-testid="actor-view"]')?.getAttribute("data-active")).toBe("true")
})
it.each([
  { id: "ordinary", title: "Supervisor", kind: "root" as const },
  { id: "child", title: "Child", kind: "child" as const, parentSessionId: "bamboo-default-supervisor", rootSessionId: "bamboo-default-supervisor" },
])("preserves the normal Actor Inspector for $id", (chat) => {
  renderSession({ ...chat, messages: [] })
  expect(document.querySelector('[data-testid="managed-view"]')).toBeNull()
  expect(document.querySelector('[data-testid="supervisor-auxiliary-agents"]')).toBeNull()
  expect(document.querySelector('[data-testid="actor-view"]')?.getAttribute("data-active")).toBe("true")
})
