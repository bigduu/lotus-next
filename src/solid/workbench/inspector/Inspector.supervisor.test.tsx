import { render } from "@solidjs/web"
import { createSignal, flush, untrack } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"
import { appStore } from "@shared/store/appStore/state"
import { createInitialExecutionState } from "@shared/store/appStore/slices/executionStateSlice/reducer"
import { agentClient, type SessionSummary } from "@services/chat/AgentService"
import { managedSessionsClient } from "@services/supervisorScope/managedSessions"
import { currentUserManagedSessionsFixture } from "@services/supervisorScope/testFixtures"
import type { ChatItem } from "@shared/types/chatMessages"
import { Inspector } from "./Inspector"
const managed = vi.hoisted(() => ({ select: null as null | ((id: string, selection?: unknown, valid?: () => boolean) => Promise<boolean>) }))
vi.mock("./ActorSnapshotPanel", () => ({ ActorSnapshotPanel: (props: { active: boolean }) => <div data-testid="actor-view" data-active={String(props.active)} /> }))
vi.mock("./SupervisorManagedSessions", () => ({ SupervisorManagedSessionsPanel: ({ onSelectSession }: { onSelectSession: (id: string) => Promise<boolean> }) => {
  managed.select = untrack(() => onSelectSession)
  return <div data-testid="managed-view" />
} }))
vi.mock("@lucide/solid", () => ({ ArrowRight: () => null, Copy: () => null, FileDiff: () => null, FolderGit2: () => null, X: () => null }))
vi.mock("./GoalSection", () => ({ GoalSection: () => null }))

function dispatch(action: () => void) {
  action()
  flush()
}
async function settle(action: () => unknown) {
  await action()
  for (let turn = 0; turn < 5; turn += 1) {
    await Promise.resolve()
    flush()
  }
}
const roots: Array<() => void> = []
const initial = appStore.getState()
afterEach(() => { for (const dispose of roots.splice(0)) dispose(); appStore.setState(initial, true); managed.select = null; vi.restoreAllMocks(); document.body.replaceChildren() })
async function renderSession(chat: Omit<ChatItem, "config" | "createdAt">) {
  appStore.setState({ chats: [{ ...chat, createdAt: 0, config: { systemPromptId: "", baseSystemPrompt: "", lastUsedEnhancedPrompt: null } }], currentSessionId: chat.id, loadTaskList: vi.fn().mockResolvedValue(undefined) })
  const [open, setOpen] = createSignal(true)
  const host = document.body.appendChild(document.createElement("div"))
  roots.push(render(() => <Inspector open={open()} sessionId={chat.id} onCopySessionId={() => {}} />, host))
  await settle(() => {})
  if (chat.id === "bamboo-default-supervisor") {
    await vi.waitFor(() => { flush(); expect(managed.select).toBeTypeOf("function") })
  }
  return () => dispatch(() => setOpen(false))
}
it("places managed sessions first and keeps Supervisor Child topology collapsed and inactive", async () => {
  await renderSession({ id: "bamboo-default-supervisor", title: "Bodhi", kind: "root", messages: [] })
  const managed = document.querySelector('[data-testid="managed-view"]')!
  const details = document.querySelector<HTMLDetailsElement>('[data-testid="supervisor-auxiliary-agents"]')!
  expect(managed.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
  expect(details.open).toBe(false); expect(details.querySelector('[data-testid="actor-view"]')?.getAttribute("data-active")).toBe("false")
  dispatch(() => { details.open = true; details.dispatchEvent(new Event("toggle")) })
  expect(details.querySelector('[data-testid="actor-view"]')?.getAttribute("data-active")).toBe("true")
})
it.each([
  { id: "ordinary", title: "Supervisor", kind: "root" as const },
  { id: "child", title: "Child", kind: "child" as const, parentSessionId: "bamboo-default-supervisor", rootSessionId: "bamboo-default-supervisor" },
])("preserves the normal Actor Inspector for $id", async (chat) => {
  await renderSession({ ...chat, messages: [] })
  expect(document.querySelector('[data-testid="managed-view"]')).toBeNull()
  expect(document.querySelector('[data-testid="supervisor-auxiliary-agents"]')).toBeNull()
  expect(document.querySelector('[data-testid="actor-view"]')?.getAttribute("data-active")).toBe("true")
})

const supervisor = "bamboo-default-supervisor"
const summaryFor = (target: { session_id: string; kind: "root" | "child"; root_session_id: string; parent_session_id: string | null; project_id: string | null; created_at: string }): SessionSummary => ({
  id: target.session_id, kind: target.kind, root_session_id: target.root_session_id, parent_session_id: target.parent_session_id,
  project_id: target.project_id, created_at: target.created_at, updated_at: target.created_at, last_activity_at: target.created_at,
  title: target.session_id, title_version: 0, pinned: false, spawn_depth: target.kind === "root" ? 0 : 1,
  model: "synthetic", message_count: 0, has_attachments: false, is_running: false,
})
async function navigation() {
  const close = await renderSession({ id: supervisor, title: "Supervisor", kind: "root", messages: [] })
  const source = appStore.getState().chats[0]
  const select = vi.fn((id: string | null) => appStore.setState({ currentSessionId: id }))
  dispatch(() => appStore.setState({ chats: [source, { ...source, id: "target", title: "Cold target", messages: [] }],
    restoreSession: vi.fn().mockResolvedValue(true), selectSession: select }))
  return { close, select }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => { resolve = complete })
  return { promise, resolve }
}
// Match the store contract: an opt-in history read confirms its target before applying.
const stagedHistory = () => vi.fn(async (id: string, options?: { beforeApply?: () => Promise<boolean>; canApply?: () => boolean; selectOnApply?: boolean }) => {
  if ((options?.beforeApply && !await options.beforeApply()) || (options?.canApply && !options.canApply())) throw new DOMException("History read discarded", "AbortError")
  if (options?.selectOnApply) appStore.setState({ currentSessionId: id, latestActiveSessionId: id })
})
it("hydrates persisted history before selecting an idle managed target opened for the first time", async () => {
  const { select } = await navigation(), history = deferred<void>()
  const load = vi.fn(async (id: string) => {
    await history.promise
    appStore.setState((state) => ({ chats: state.chats.map((chat) => chat.id !== id ? chat : { ...chat,
      messages: [{ id: "persisted", role: "assistant", type: "text", content: "Saved target history", createdAt: "2026-10-25T00:00:00Z" }] }) }))
  })
  dispatch(() => appStore.setState({ loadChatHistory: load }))
  let opening!: Promise<boolean>
  await settle(async () => { opening = managed.select!("target") })
  expect(load).toHaveBeenCalledExactlyOnceWith("target", { throwOnError: true })
  expect(select).not.toHaveBeenCalled()
  expect(appStore.getState().currentSessionId).toBe(supervisor)
  await settle(async () => { history.resolve(); await opening })
  expect(select).toHaveBeenCalledExactlyOnceWith("target")
  expect(appStore.getState().chats.find((chat) => chat.id === "target")?.messages[0]).toMatchObject({ content: "Saved target history" })
})
it("does not hydrate or select a late restored target after the user selects another session", async () => {
  const { select } = await navigation(), restored = deferred<boolean>(), load = vi.fn()
  dispatch(() => appStore.setState({ restoreSession: vi.fn(() => restored.promise), loadChatHistory: load }))
  let opening!: Promise<boolean>
  await settle(async () => { opening = managed.select!("target") })
  dispatch(() => appStore.setState({ currentSessionId: "other" }))
  await settle(async () => { restored.resolve(true); expect(await opening).toBe(false) })
  expect(load).not.toHaveBeenCalled(); expect(select).not.toHaveBeenCalled()
  expect(appStore.getState().currentSessionId).toBe("other")
})
it("a slow managed history read cannot override a newer user selection", async () => {
  const { select } = await navigation(), history = deferred<void>(), load = vi.fn(() => history.promise)
  dispatch(() => appStore.setState({ loadChatHistory: load }))
  let opening!: Promise<boolean>
  await settle(async () => { opening = managed.select!("target") })
  expect(load).toHaveBeenCalledExactlyOnceWith("target", { throwOnError: true })
  dispatch(() => appStore.setState({ currentSessionId: "other" }))
  await settle(async () => { history.resolve(); expect(await opening).toBe(false) })
  expect(select).not.toHaveBeenCalled()
  expect(appStore.getState().currentSessionId).toBe("other")
})
it("closing the Inspector retires an unfinished managed navigation before selection", async () => {
  const { close, select } = await navigation(), history = deferred<void>(), load = vi.fn(() => history.promise)
  dispatch(() => appStore.setState({ loadChatHistory: load }))
  let opening!: Promise<boolean>
  await settle(async () => { opening = managed.select!("target") })
  expect(load).toHaveBeenCalledExactlyOnceWith("target", { throwOnError: true })
  close()
  await settle(async () => { history.resolve(); expect(await opening).toBe(false) })
  expect(select).not.toHaveBeenCalled()
  expect(appStore.getState().currentSessionId).toBe(supervisor)
})


it("refuses a current-user target replaced before the open click", async () => {
  const { select } = await navigation(), fixture = currentUserManagedSessionsFixture()
  const target = { ...fixture.sessions[0]!.current_user_target!, session_id: "target", root_session_id: "target" }
  const changed = { ...target, authority_sha256: "e".repeat(64) }
  vi.spyOn(managedSessionsClient, "read").mockResolvedValue({ ...fixture, sessions: [{ ...fixture.sessions[0]!, session_id: "target", current_user_target: changed }] })
  const restore = vi.fn().mockResolvedValue(true), load = vi.fn().mockResolvedValue(undefined)
  dispatch(() => appStore.setState({ restoreSession: restore, loadChatHistory: load }))
  await settle(async () => { expect(await managed.select!("target", { target, supervisor: fixture.scope.supervisor })).toBe(false) })
  expect(restore).not.toHaveBeenCalled(); expect(load).not.toHaveBeenCalled(); expect(select).not.toHaveBeenCalled()
})
it("does not start navigation when the user switches sessions during target revalidation", async () => {
  const { select } = await navigation(), fixture = currentUserManagedSessionsFixture(), pending = deferred<typeof fixture>()
  const target = { ...fixture.sessions[0]!.current_user_target!, session_id: "target", root_session_id: "target" }
  vi.spyOn(managedSessionsClient, "read").mockReturnValue(pending.promise)
  const restore = vi.fn().mockResolvedValue(true), load = vi.fn().mockResolvedValue(undefined)
  dispatch(() => appStore.setState({ restoreSession: restore, loadChatHistory: load }))
  let opening!: Promise<boolean>
  await settle(async () => { opening = managed.select!("target", { target, supervisor: fixture.scope.supervisor }) })
  dispatch(() => appStore.setState({ currentSessionId: "other" }))
  await settle(async () => { pending.resolve({ ...fixture, sessions: [{ ...fixture.sessions[0]!, session_id: "target", current_user_target: target }] }); expect(await opening).toBe(false) })
  expect(restore).not.toHaveBeenCalled(); expect(load).not.toHaveBeenCalled(); expect(select).not.toHaveBeenCalled()
})


it("opens a matching current-user target only after fresh checks before and after history", async () => {
  await navigation()
  const fixture = currentUserManagedSessionsFixture()
  const target = { ...fixture.sessions[0]!.current_user_target!, session_id: "target", root_session_id: "target" }
  const read = vi.spyOn(managedSessionsClient, "read").mockResolvedValue({ ...fixture, sessions: [{ ...fixture.sessions[0]!, session_id: "target", current_user_target: target }] })
  const load = stagedHistory()
  dispatch(() => appStore.setState((state) => ({ loadChatHistory: load, chats: state.chats.map((chat) => chat.id === "target"
    ? { ...chat, kind: "root", rootSessionId: "target", parentSessionId: null, createdAt: Date.parse(target.created_at), createdAtExact: target.created_at, config: { ...chat.config, projectId: null } } : chat) })))
  await settle(async () => { expect(await managed.select!("target", { target, supervisor: fixture.scope.supervisor })).toBe(true) })
  expect(read).toHaveBeenCalledTimes(2); expect(load).toHaveBeenCalledExactlyOnceWith("target", expect.objectContaining({ throwOnError: true, beforeApply: expect.any(Function) }))
  expect(appStore.getState().currentSessionId).toBe("target")
})
it("does not select a target whose canonical identity changes during its history read", async () => {
  const { select } = await navigation(), fixture = currentUserManagedSessionsFixture()
  const target = { ...fixture.sessions[0]!.current_user_target!, session_id: "target", root_session_id: "target" }
  const entry = { ...fixture.sessions[0]!, session_id: "target", current_user_target: target }
  vi.spyOn(managedSessionsClient, "read").mockResolvedValueOnce({ ...fixture, sessions: [entry] })
    .mockResolvedValueOnce({ ...fixture, sessions: [{ ...entry, current_user_target: { ...target, ancestry_sha256: "f".repeat(64) } }] })
  dispatch(() => appStore.setState((state) => ({ loadChatHistory: stagedHistory(), chats: state.chats.map((chat) => chat.id === "target"
    ? { ...chat, kind: "root", rootSessionId: "target", parentSessionId: null, createdAt: Date.parse(target.created_at), createdAtExact: target.created_at, config: { ...chat.config, projectId: null } } : chat) })))
  await settle(async () => { expect(await managed.select!("target", { target, supervisor: fixture.scope.supervisor })).toBe(false) })
  expect(select).not.toHaveBeenCalled()
})


it("does not load history into a cached session with a different birth identity", async () => {
  const { select } = await navigation(), fixture = currentUserManagedSessionsFixture()
  const target = { ...fixture.sessions[0]!.current_user_target!, session_id: "target", root_session_id: "target" }
  vi.spyOn(managedSessionsClient, "read").mockResolvedValue({ ...fixture, sessions: [{ ...fixture.sessions[0]!, session_id: "target", current_user_target: target }] })
  const load = vi.fn().mockResolvedValue(undefined)
  dispatch(() => appStore.setState({ loadChatHistory: load }))
  await settle(async () => { expect(await managed.select!("target", { target, supervisor: fixture.scope.supervisor })).toBe(false) })
  expect(load).not.toHaveBeenCalled(); expect(select).not.toHaveBeenCalled()
})


it("refreshes stale cached Project metadata for the same observed lifetime", async () => {
  await navigation()
  const fixture = currentUserManagedSessionsFixture()
  const target = { ...fixture.sessions[0]!.current_user_target!, session_id: "target", root_session_id: "target", project_id: "p2" }
  vi.spyOn(managedSessionsClient, "read").mockResolvedValue({ ...fixture, sessions: [{ ...fixture.sessions[0]!, session_id: "target", current_user_target: target }] })
  const detail = summaryFor(target), stage = vi.fn().mockResolvedValue([detail])
  vi.spyOn(agentClient, "getSession").mockResolvedValue({ session: detail })
  dispatch(() => appStore.setState((state) => ({ stageSessionForNavigation: stage, loadChatHistory: stagedHistory(), chats: state.chats.map((chat) => chat.id === "target"
    ? { ...chat, kind: "root", rootSessionId: "target", parentSessionId: null, createdAt: Date.parse(target.created_at), createdAtExact: target.created_at, config: { ...chat.config, projectId: "p1" } } : chat) })))
  await settle(async () => { expect(await managed.select!("target", { target, supervisor: fixture.scope.supervisor })).toBe(true) })
  expect(stage).toHaveBeenCalledExactlyOnceWith(detail); expect(appStore.getState().currentSessionId).toBe("target")
})
it("does not select a cache replaced while the final canonical check is pending", async () => {
  const { select } = await navigation(), fixture = currentUserManagedSessionsFixture(), pending = deferred<typeof fixture>()
  const target = { ...fixture.sessions[0]!.current_user_target!, session_id: "target", root_session_id: "target" }
  const stable = { ...fixture, sessions: [{ ...fixture.sessions[0]!, session_id: "target", current_user_target: target }] }
  const read = vi.spyOn(managedSessionsClient, "read").mockResolvedValueOnce(stable).mockReturnValueOnce(pending.promise)
  dispatch(() => appStore.setState((state) => ({ loadChatHistory: stagedHistory(), chats: state.chats.map((chat) => chat.id === "target"
    ? { ...chat, kind: "root", rootSessionId: "target", parentSessionId: null, createdAt: Date.parse(target.created_at), createdAtExact: target.created_at, config: { ...chat.config, projectId: null } } : chat) })))
  let opening!: Promise<boolean>
  await settle(async () => { opening = managed.select!("target", { target, supervisor: fixture.scope.supervisor }); await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2)) })
  dispatch(() => appStore.setState((state) => ({ chats: state.chats.map((chat) => chat.id === "target" ? { ...chat, createdAt: chat.createdAt + 1 } : chat) })))
  await settle(async () => { pending.resolve(stable); expect(await opening).toBe(false) }); expect(select).not.toHaveBeenCalled()
})
it("does not select when its originating directory guard expires during final revalidation", async () => {
  const { select } = await navigation(), fixture = currentUserManagedSessionsFixture(), pending = deferred<typeof fixture>()
  const target = { ...fixture.sessions[0]!.current_user_target!, session_id: "target", root_session_id: "target" }
  const stable = { ...fixture, sessions: [{ ...fixture.sessions[0]!, session_id: "target", current_user_target: target }] }
  const read = vi.spyOn(managedSessionsClient, "read").mockResolvedValueOnce(stable).mockReturnValueOnce(pending.promise)
  dispatch(() => appStore.setState((state) => ({ loadChatHistory: stagedHistory(), chats: state.chats.map((chat) => chat.id === "target"
    ? { ...chat, kind: "root", rootSessionId: "target", parentSessionId: null, createdAt: Date.parse(target.created_at), createdAtExact: target.created_at, config: { ...chat.config, projectId: null } } : chat) })))
  let allowed = true, opening!: Promise<boolean>
  await settle(async () => { opening = managed.select!("target", { target, supervisor: fixture.scope.supervisor }, () => allowed); await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2)) })
  allowed = false
  await settle(async () => { pending.resolve(stable); expect(await opening).toBe(false) }); expect(select).not.toHaveBeenCalled()
})


it("refreshes a stale Child Project through its Root tree even when the child count is unchanged", async () => {
  await navigation()
  const fixture = currentUserManagedSessionsFixture()
  const target = { ...fixture.sessions[1]!.current_user_target!, session_id: "target", project_id: "p2" }
  vi.spyOn(managedSessionsClient, "read").mockResolvedValue({ ...fixture, sessions: [{ ...fixture.sessions[1]!, session_id: "target", current_user_target: target }] })
  const detail = summaryFor(target), stage = vi.fn().mockResolvedValue([detail])
  vi.spyOn(agentClient, "getSession").mockResolvedValue({ session: detail })
  dispatch(() => appStore.setState((state) => ({ stageSessionForNavigation: stage, loadChatHistory: stagedHistory(), chats: state.chats.map((chat) => chat.id === "target"
    ? { ...chat, kind: "child", rootSessionId: target.root_session_id, parentSessionId: target.parent_session_id, createdAt: Date.parse(target.created_at), createdAtExact: target.created_at, config: { ...chat.config, projectId: "p1" } } : chat) })))
  await settle(async () => { expect(await managed.select!("target", { target, supervisor: fixture.scope.supervisor })).toBe(true) })
  expect(stage).toHaveBeenCalledExactlyOnceWith(detail); expect(appStore.getState().currentSessionId).toBe("target")
})

it.each([
  { event: "unrelated deletion", opens: true },
  { event: "target deletion", opens: false },
  { event: "root deletion", opens: false },
  { event: "cold sibling deletion", opens: false },
  { event: "account-wide invalidation", opens: false },
  { event: "unchanged execution summary", opens: true },
  { event: "new execution", opens: false },
])("handles $event while staging a managed Child tree", async ({ event, opens }) => {
  await navigation()
  const fixture = currentUserManagedSessionsFixture()
  const child = fixture.sessions[1]!.current_user_target!
  const root = summaryFor({ ...child, session_id: child.root_session_id, kind: "root", parent_session_id: null })
  const detail = summaryFor(child)
  const sibling = { ...detail, id: "cold-sibling" }
  const staged = deferred<SessionSummary[]>()
  const stage = vi.fn(() => staged.promise)
  const load = stagedHistory()
  const execution = createInitialExecutionState(root.id)
  vi.spyOn(managedSessionsClient, "read").mockResolvedValue(fixture)
  vi.spyOn(agentClient, "getSession").mockResolvedValue({ session: detail })
  dispatch(() => appStore.setState({
    stageSessionForNavigation: stage,
    loadChatHistory: load,
    executionBySession: { [root.id]: execution },
  }))

  let opening!: Promise<boolean>
  await settle(async () => {
    opening = managed.select!(child.session_id, { target: child, supervisor: fixture.scope.supervisor })
    await vi.waitFor(() => expect(stage).toHaveBeenCalledOnce())
  })
  dispatch(() => {
    if (event === "unchanged execution summary" || event === "new execution") {
      appStore.setState({
        executionBySession: {
          [root.id]: {
            ...execution,
            ...(event === "new execution" ? { generation: 1, phase: "starting" } : {}),
            backend: { ...execution.backend, syncedAt: "2026-11-01T00:00:00Z" },
          },
        },
      })
    } else {
      const deletedId = {
        "unrelated deletion": "other-root",
        "target deletion": child.session_id,
        "root deletion": root.id,
        "cold sibling deletion": sibling.id,
        "account-wide invalidation": undefined,
      }[event]
      appStore.getState().invalidateSessionNavigation(deletedId)
    }
  })
  await settle(async () => {
    staged.resolve([root, detail, sibling])
    expect(await opening).toBe(opens)
  })
  expect(appStore.getState().currentSessionId).toBe(opens ? child.session_id : supervisor)
  expect(load).toHaveBeenCalledTimes(opens ? 1 : 0)
})
