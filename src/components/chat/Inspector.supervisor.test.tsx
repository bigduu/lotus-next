import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { useAppStore } from "@shared/store/appStore"
import type { ChatItem } from "@shared/types/chatMessages"
import { Inspector } from "./Inspector"
const managed = vi.hoisted(() => ({ select: null as null | ((id: string) => Promise<boolean>) }))
vi.mock("./ActorSnapshotPanel", () => ({ ActorSnapshotPanel: ({ active }: { active: boolean }) => <div data-testid="actor-view" data-active={String(active)} /> }))
vi.mock("./SupervisorManagedSessions", () => ({ SupervisorManagedSessionsPanel: ({ onSelectSession }: { onSelectSession: (id: string) => Promise<boolean> }) => {
  managed.select = onSelectSession
  return <div data-testid="managed-view" />
} }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const roots: Root[] = []
const initial = useAppStore.getState()
afterEach(() => { for (const root of roots.splice(0)) act(() => root.unmount()); useAppStore.setState(initial, true); managed.select = null; document.body.replaceChildren() })
function renderSession(chat: Omit<ChatItem, "config" | "createdAt">) {
  useAppStore.setState({ chats: [{ ...chat, createdAt: 0, config: { systemPromptId: "", baseSystemPrompt: "", lastUsedEnhancedPrompt: null } }], currentSessionId: chat.id, loadTaskList: vi.fn().mockResolvedValue(undefined) })
  const root = createRoot(document.body.appendChild(document.createElement("div"))); roots.push(root)
  act(() => root.render(<Inspector embedded open sessionId={chat.id} onClose={() => {}} onCopySessionId={() => {}} />))
  return root
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

const supervisor = "bamboo-default-supervisor"
function navigation() {
  const root = renderSession({ id: supervisor, title: "Supervisor", kind: "root", messages: [] })
  const source = useAppStore.getState().chats[0]
  const select = vi.fn((id: string | null) => useAppStore.setState({ currentSessionId: id }))
  act(() => useAppStore.setState({ chats: [source, { ...source, id: "target", title: "Cold target", messages: [] }],
    restoreSession: vi.fn().mockResolvedValue(true), selectSession: select }))
  return { root, select }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => { resolve = complete })
  return { promise, resolve }
}
it("hydrates persisted history before selecting an idle managed target opened for the first time", async () => {
  const { select } = navigation(), history = deferred<void>()
  const load = vi.fn(async (id: string) => {
    await history.promise
    useAppStore.setState((state) => ({ chats: state.chats.map((chat) => chat.id !== id ? chat : { ...chat,
      messages: [{ id: "persisted", role: "assistant", type: "text", content: "Saved target history", createdAt: "2026-10-25T00:00:00Z" }] }) }))
  })
  act(() => useAppStore.setState({ loadChatHistory: load }))
  let opening!: Promise<boolean>
  await act(async () => { opening = managed.select!("target") })
  expect(load).toHaveBeenCalledExactlyOnceWith("target", { throwOnError: true })
  expect(select).not.toHaveBeenCalled()
  expect(useAppStore.getState().currentSessionId).toBe(supervisor)
  await act(async () => { history.resolve(); await opening })
  expect(select).toHaveBeenCalledExactlyOnceWith("target")
  expect(useAppStore.getState().chats.find((chat) => chat.id === "target")?.messages[0]).toMatchObject({ content: "Saved target history" })
})
it("does not hydrate or select a late restored target after the user selects another session", async () => {
  const { select } = navigation(), restored = deferred<boolean>(), load = vi.fn()
  act(() => useAppStore.setState({ restoreSession: vi.fn(() => restored.promise), loadChatHistory: load }))
  let opening!: Promise<boolean>
  await act(async () => { opening = managed.select!("target") })
  act(() => useAppStore.setState({ currentSessionId: "other" }))
  await act(async () => { restored.resolve(true); expect(await opening).toBe(false) })
  expect(load).not.toHaveBeenCalled(); expect(select).not.toHaveBeenCalled()
  expect(useAppStore.getState().currentSessionId).toBe("other")
})
it("a slow managed history read cannot override a newer user selection", async () => {
  const { select } = navigation(), history = deferred<void>(), load = vi.fn(() => history.promise)
  act(() => useAppStore.setState({ loadChatHistory: load }))
  let opening!: Promise<boolean>
  await act(async () => { opening = managed.select!("target") })
  expect(load).toHaveBeenCalledExactlyOnceWith("target", { throwOnError: true })
  act(() => useAppStore.setState({ currentSessionId: "other" }))
  await act(async () => { history.resolve(); expect(await opening).toBe(false) })
  expect(select).not.toHaveBeenCalled()
  expect(useAppStore.getState().currentSessionId).toBe("other")
})
it("closing the Inspector retires an unfinished managed navigation before selection", async () => {
  const { root, select } = navigation(), history = deferred<void>(), load = vi.fn(() => history.promise)
  act(() => useAppStore.setState({ loadChatHistory: load }))
  let opening!: Promise<boolean>
  await act(async () => { opening = managed.select!("target") })
  expect(load).toHaveBeenCalledExactlyOnceWith("target", { throwOnError: true })
  act(() => root.render(<Inspector embedded open={false} sessionId={supervisor} onClose={() => {}} onCopySessionId={() => {}} />))
  await act(async () => { history.resolve(); expect(await opening).toBe(false) })
  expect(select).not.toHaveBeenCalled()
  expect(useAppStore.getState().currentSessionId).toBe(supervisor)
})
