import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { useAppStore } from "@shared/store/appStore"
import type { ChatItem } from "@shared/types/chatMessages"
import { agentClient, type HistoryResponse, type SessionSummary } from "@services/chat/AgentService"
import { managedSessionsClient } from "@services/supervisorScope/managedSessions"
import { currentUserManagedSessionsFixture } from "@services/supervisorScope/testFixtures"
import { sessionSummaryToChatItem } from "@shared/store/appStore/slices/chatSessionSlice/messageMapping"
import { Inspector } from "./Inspector"

const managed = vi.hoisted(() => ({ select: null as null | ((id: string, selection?: unknown, current?: () => boolean) => Promise<boolean>) }))
vi.mock("./ActorSnapshotPanel", () => ({ ActorSnapshotPanel: () => <div /> }))
vi.mock("./SupervisorManagedSessions", () => ({ SupervisorManagedSessionsPanel: ({ onSelectSession }: { onSelectSession: typeof managed.select }) => {
  managed.select = onSelectSession
  return <div />
} }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const supervisor = "bamboo-default-supervisor"
const initial = useAppStore.getState()
const roots: Root[] = []
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  useAppStore.setState(initial, true)
  managed.select = null
  vi.restoreAllMocks()
  document.body.replaceChildren()
})
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const history = (id: string, content: string): HistoryResponse => ({ session_id: id, messages: [
  { id: `${id}-${content}`, role: "assistant", content, created_at: "2026-10-29T00:00:00Z" },
] })
const summary = (id: string, createdAt = "2026-10-27T00:00:00Z"): SessionSummary => ({
  id, kind: "root", root_session_id: id, parent_session_id: null, title: id, title_version: 0, pinned: false,
  spawn_depth: 0, model: "synthetic", created_at: createdAt, updated_at: createdAt, last_activity_at: createdAt,
  message_count: 1, has_attachments: false, is_running: false, project_id: null,
})
const chat = (id: string, rootSessionId = id): ChatItem => ({
  id, kind: "root", rootSessionId, parentSessionId: null, title: id, createdAt: Date.parse("2026-10-27T00:00:00Z"), createdAtExact: "2026-10-27T00:00:00Z",
  messageCount: 1, messages: [{ id: `${id}-original`, role: "assistant", type: "text", content: `original-${id}`, createdAt: "2026-10-27T00:00:01Z" }],
  config: { systemPromptId: "", baseSystemPrompt: "", lastUsedEnhancedPrompt: null, projectId: null },
})

async function setup() {
  const fixture = currentUserManagedSessionsFixture()
  const target = { ...fixture.sessions[0]!.current_user_target!, session_id: "target", root_session_id: "target" }
  const second = { ...target, session_id: "second", root_session_id: "second" }
  const entry = { ...fixture.sessions[0]!, session_id: target.session_id, root_session_id: target.root_session_id, current_user_target: target }
  const secondEntry = { ...entry, session_id: second.session_id, root_session_id: second.root_session_id, current_user_target: second }
  const page = { ...fixture, sessions: [entry, secondEntry] }
  const read = vi.spyOn(managedSessionsClient, "read").mockResolvedValue(page)
  vi.spyOn(managedSessionsClient, "readBoundHistory").mockImplementation((selected) => agentClient.getHistory(selected.target.session_id))
  const select = vi.fn((id: string | null) => useAppStore.setState({ currentSessionId: id }))
  useAppStore.setState({ chats: [chat(supervisor), chat("target"), chat("second")], currentSessionId: supervisor,
    restoreSession: vi.fn().mockResolvedValue(true), selectSession: select, loadTaskList: vi.fn().mockResolvedValue(undefined) })
  const root = createRoot(document.body.appendChild(document.createElement("div"))); roots.push(root)
  await act(async () => root.render(<Inspector embedded open sessionId={supervisor} onClose={() => {}} onCopySessionId={() => {}} />))
  return { fixture, target, second, entry, page, read, select, root }
}
const cached = (id: string) => useAppStore.getState().chats.find((item) => item.id === id)
const selection = (fixture: ReturnType<typeof currentUserManagedSessionsFixture>, target: NonNullable<ReturnType<typeof currentUserManagedSessionsFixture>["sessions"][number]["current_user_target"]>) => ({ target, supervisor: fixture.scope.supervisor })

it("leaves the original cache and navigation unchanged when the target is replaced during history", async () => {
  const { fixture, target, entry, page, read, select } = await setup()
  const replacement = { ...target, created_at: "2026-10-28T00:00:00Z", ancestry_sha256: "f".repeat(64) }
  read.mockResolvedValueOnce(page).mockResolvedValueOnce({ ...page, sessions: [{ ...entry, current_user_target: replacement }] })
  vi.spyOn(agentClient, "getHistory").mockResolvedValue(history("target", "replacement"))
  const before = cached("target")
  await act(async () => { expect(await managed.select!("target", selection(fixture, target))).toBe(false) })
  expect(cached("target")).toEqual(before)
  expect(select).not.toHaveBeenCalled()
  expect(useAppStore.getState().currentSessionId).toBe(supervisor)
})

it("does not apply a late history response after the user switches sessions", async () => {
  const { fixture, target, select } = await setup(), pending = deferred<HistoryResponse>()
  const readHistory = vi.spyOn(agentClient, "getHistory").mockReturnValue(pending.promise)
  const before = cached("target")
  let opening!: Promise<boolean>
  await act(async () => { opening = managed.select!("target", selection(fixture, target)); await vi.waitFor(() => expect(readHistory).toHaveBeenCalledOnce()) })
  act(() => useAppStore.setState({ currentSessionId: "second" }))
  await act(async () => { pending.resolve(history("target", "late")); expect(await opening).toBe(false) })
  expect(cached("target")).toEqual(before)
  expect(select).not.toHaveBeenCalled()
  expect(useAppStore.getState().currentSessionId).toBe("second")
})

it("does not apply staged history while final verification is pending or after the inspector closes", async () => {
  const { fixture, target, page, read, select, root } = await setup(), pending = deferred<typeof page>()
  read.mockResolvedValueOnce(page).mockReturnValueOnce(pending.promise)
  vi.spyOn(agentClient, "getHistory").mockResolvedValue(history("target", "staged"))
  const before = cached("target")
  let opening!: Promise<boolean>
  await act(async () => { opening = managed.select!("target", selection(fixture, target)); await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2)) })
  expect(cached("target")).toEqual(before)
  act(() => root.render(<Inspector embedded open={false} sessionId={supervisor} onClose={() => {}} onCopySessionId={() => {}} />))
  await act(async () => { pending.resolve(page); expect(await opening).toBe(false) })
  expect(cached("target")).toEqual(before)
  expect(select).not.toHaveBeenCalled()
})

it("allows a later opening to win without writing the abandoned target's late response", async () => {
  const { fixture, target, second } = await setup(), pending = deferred<HistoryResponse>()
  const readHistory = vi.spyOn(agentClient, "getHistory").mockImplementation((id) => id === "target" ? pending.promise : Promise.resolve(history(id, "new")))
  const before = cached("target")
  let older!: Promise<boolean>
  await act(async () => { older = managed.select!("target", selection(fixture, target)); await vi.waitFor(() => expect(readHistory).toHaveBeenCalledWith("target")) })
  await act(async () => { expect(await managed.select!("second", selection(fixture, second))).toBe(true) })
  expect(cached("second")?.messages[0]).toMatchObject({ content: "new" })
  await act(async () => { pending.resolve(history("target", "late")); expect(await older).toBe(false) })
  expect(cached("target")).toEqual(before)
  expect(useAppStore.getState().currentSessionId).toBe("second")
  expect(useAppStore.getState().currentSessionId).toBe("second")
})

it("commits history after successful final verification and then opens the matching target", async () => {
  const { fixture, target, page, read, select } = await setup(), pending = deferred<typeof page>()
  read.mockResolvedValueOnce(page).mockReturnValueOnce(pending.promise)
  vi.spyOn(agentClient, "getHistory").mockResolvedValue(history("target", "verified"))
  const before = cached("target")
  let opening!: Promise<boolean>
  await act(async () => { opening = managed.select!("target", selection(fixture, target)); await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2)) })
  expect(cached("target")).toEqual(before)
  expect(select).not.toHaveBeenCalled()
  await act(async () => { pending.resolve(page); expect(await opening).toBe(true) })
  expect(cached("target")?.messages[0]).toMatchObject({ content: "verified" })
  expect(useAppStore.getState().currentSessionId).toBe("target")
})

it("does not let an older same-session confirmation overwrite a newer opening", async () => {
  const { fixture, target, page, read } = await setup(), pending = deferred<typeof page>()
  read.mockResolvedValueOnce(page).mockReturnValueOnce(pending.promise)
  vi.spyOn(agentClient, "getHistory").mockResolvedValueOnce(history("target", "older")).mockResolvedValueOnce(history("target", "newer"))
  let older!: Promise<boolean>
  await act(async () => { older = managed.select!("target", selection(fixture, target)); await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2)) })
  await act(async () => { expect(await managed.select!("target", selection(fixture, target))).toBe(true) })
  expect(cached("target")?.messages[0]).toMatchObject({ content: "newer" })
  await act(async () => { pending.resolve(page); expect(await older).toBe(false) })
  expect(cached("target")?.messages[0]).toMatchObject({ content: "newer" })
  expect(useAppStore.getState().currentSessionId).toBe("target")
})

it("discards history when its directory guard expires during final verification", async () => {
  const { fixture, target, page, read, select } = await setup(), pending = deferred<typeof page>()
  read.mockResolvedValueOnce(page).mockReturnValueOnce(pending.promise)
  vi.spyOn(agentClient, "getHistory").mockResolvedValue(history("target", "staged"))
  const before = cached("target")
  let allowed = true, opening!: Promise<boolean>
  await act(async () => { opening = managed.select!("target", selection(fixture, target), () => allowed); await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2)) })
  allowed = false
  await act(async () => { pending.resolve(page); expect(await opening).toBe(false) })
  expect(cached("target")).toEqual(before)
  expect(select).not.toHaveBeenCalled()
})

it("leaves cache and navigation untouched when final verification errors", async () => {
  const { fixture, target, page, read, select } = await setup()
  read.mockResolvedValueOnce(page).mockRejectedValueOnce(new Error("synthetic verification failure"))
  vi.spyOn(agentClient, "getHistory").mockResolvedValue(history("target", "staged"))
  vi.spyOn(console, "warn").mockImplementation(() => {})
  const before = cached("target")
  await act(async () => { await expect(managed.select!("target", selection(fixture, target))).rejects.toThrow("synthetic verification failure") })
  expect(cached("target")).toEqual(before)
  expect(select).not.toHaveBeenCalled()
})

it("does not commit a replaced Child's history into the previously observed Child", async () => {
  const { fixture, read, select } = await setup()
  const target = { ...fixture.sessions[1]!.current_user_target!, session_id: "target" }
  const entry = { ...fixture.sessions[1]!, session_id: target.session_id, current_user_target: target }
  const page = { ...fixture, sessions: [entry] }
  const replacement = { ...target, created_at: "2026-10-28T00:00:00Z" }
  read.mockResolvedValueOnce(page).mockResolvedValueOnce({ ...page, sessions: [{ ...entry, current_user_target: replacement }] })
  act(() => useAppStore.setState((state) => ({ chats: state.chats.map((item) => item.id === "target"
    ? { ...item, kind: "child", rootSessionId: target.root_session_id, parentSessionId: target.parent_session_id,
      createdAt: Date.parse(target.created_at), createdAtExact: target.created_at, config: { ...item.config, projectId: target.project_id } } : item) })))
  vi.spyOn(agentClient, "getHistory").mockResolvedValue(history("target", "replacement-child"))
  const before = cached("target")
  await act(async () => { expect(await managed.select!("target", selection(fixture, target))).toBe(false) })
  expect(cached("target")).toEqual(before)
  expect(select).not.toHaveBeenCalled()
})

it("does not insert a different lifetime returned by a cold restore", async () => {
  const { fixture, target, select } = await setup()
  act(() => useAppStore.setState((state) => ({ chats: state.chats.filter((item) => item.id !== "target"),
    restoreSession: initial.restoreSession, loadSubagentSessions: vi.fn().mockResolvedValue(undefined) })))
  vi.spyOn(agentClient, "getSession").mockResolvedValue({ session: summary("target", "2026-10-28T00:00:00Z") })
  const readHistory = vi.spyOn(agentClient, "getHistory").mockResolvedValue(history("target", "replacement"))
  const before = useAppStore.getState().chats
  await act(async () => { expect(await managed.select!("target", selection(fixture, target))).toBe(false) })
  expect(useAppStore.getState().chats).toEqual(before)
  expect(readHistory).not.toHaveBeenCalled()
  expect(select).not.toHaveBeenCalled()
})

it("does not insert a cold target after its opening is cancelled", async () => {
  const { fixture, target, select } = await setup(), pending = deferred<{ session: SessionSummary }>()
  act(() => useAppStore.setState((state) => ({ chats: state.chats.filter((item) => item.id !== "target"),
    restoreSession: initial.restoreSession, loadSubagentSessions: vi.fn().mockResolvedValue(undefined) })))
  const detail = vi.spyOn(agentClient, "getSession").mockReturnValue(pending.promise)
  const before = useAppStore.getState().chats
  let opening!: Promise<boolean>
  await act(async () => { opening = managed.select!("target", selection(fixture, target)); await vi.waitFor(() => expect(detail).toHaveBeenCalledOnce()) })
  act(() => useAppStore.setState({ currentSessionId: "second" }))
  await act(async () => { pending.resolve({ session: summary("target") }); expect(await opening).toBe(false) })
  expect(useAppStore.getState().chats).toEqual(before)
  expect(select).not.toHaveBeenCalled()
})

it("does not insert a cold target if its final directory revalidation fails", async () => {
  const { fixture, target, page, entry, read, select } = await setup()
  act(() => useAppStore.setState((state) => ({ chats: state.chats.filter((item) => item.id !== "target"),
    restoreSession: initial.restoreSession, loadSubagentSessions: vi.fn().mockResolvedValue(undefined) })))
  vi.spyOn(agentClient, "getSession").mockResolvedValue({ session: summary("target") })
  vi.spyOn(agentClient, "getHistory").mockResolvedValue(history("target", "staged"))
  read.mockResolvedValueOnce(page).mockResolvedValueOnce({ ...page, sessions: [{ ...entry,
    current_user_target: { ...target, created_at: "2026-10-28T00:00:00Z" } }] })
  const before = useAppStore.getState().chats
  await act(async () => { expect(await managed.select!("target", selection(fixture, target))).toBe(false) })
  expect(useAppStore.getState().chats).toEqual(before)
  expect(select).not.toHaveBeenCalled()
})

it("does not treat different sub-millisecond session births as the same cached lifetime", async () => {
  const { fixture, page, read, select } = await setup()
  const target = { ...fixture.sessions[0]!.current_user_target!, session_id: "target", root_session_id: "target",
    created_at: "2026-10-27T00:00:00.123456Z" }
  const entry = { ...fixture.sessions[0]!, session_id: "target", current_user_target: target }
  read.mockResolvedValue({ ...page, sessions: [entry] })
  const cachedOther = sessionSummaryToChatItem(summary("target", "2026-10-27T00:00:00.123789Z"))
  act(() => useAppStore.setState((state) => ({ chats: state.chats.map((item) => item.id === "target" ? cachedOther : item) })))
  const readHistory = vi.spyOn(agentClient, "getHistory").mockResolvedValue(history("target", "different-birth"))
  const before = cached("target")
  await act(async () => { expect(await managed.select!("target", selection(fixture, target))).toBe(false) })
  expect(cached("target")).toEqual(before)
  expect(readHistory).not.toHaveBeenCalled()
  expect(select).not.toHaveBeenCalled()
})


it("commits a cold Root and its history only after final verification", async () => {
  const { fixture, target, page, read } = await setup(), pending = deferred<typeof page>()
  act(() => useAppStore.setState((state) => ({ chats: state.chats.filter((item) => item.id !== "target") })))
  vi.spyOn(agentClient, "getSession").mockResolvedValue({ session: summary("target") })
  vi.spyOn(agentClient, "getHistory").mockResolvedValue(history("target", "cold-root"))
  read.mockResolvedValueOnce(page).mockReturnValueOnce(pending.promise)
  let opening!: Promise<boolean>
  await act(async () => { opening = managed.select!("target", selection(fixture, target)); await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2)) })
  expect(cached("target")).toBeUndefined()
  await act(async () => { pending.resolve(page); expect(await opening).toBe(true) })
  expect(cached("target")?.messages[0]).toMatchObject({ content: "cold-root" })
  expect(useAppStore.getState().currentSessionId).toBe("target")
})

it("atomically inserts a cold Child, its Root, and history without overwriting a newer sibling", async () => {
  const { fixture, read } = await setup()
  const target = { ...fixture.sessions[1]!.current_user_target!, session_id: "target" }
  const entry = { ...fixture.sessions[1]!, session_id: target.session_id, current_user_target: target }
  const page = { ...fixture, sessions: [entry] }, pending = deferred<typeof page>()
  const child: SessionSummary = { ...summary("target", target.created_at), kind: "child", root_session_id: target.root_session_id,
    parent_session_id: target.parent_session_id, project_id: target.project_id, spawn_depth: 1 }
  const root: SessionSummary = { ...summary(target.root_session_id), subagent_count: 2 }
  const sibling: SessionSummary = { ...child, id: "sibling", title: "old sibling" }
  act(() => useAppStore.setState((state) => ({ chats: [...state.chats.filter((item) => item.id !== "target"),
    { ...sessionSummaryToChatItem(sibling), title: "new sibling" }] })))
  vi.spyOn(agentClient, "getSession").mockImplementation(async (id) => ({ session: id === "target" ? child : root }))
  vi.spyOn(agentClient, "listSessions").mockResolvedValue({ sessions: [child, sibling], total: 2, limit: 200, offset: 0 })
  vi.spyOn(agentClient, "getHistory").mockResolvedValue(history("target", "cold-child"))
  read.mockResolvedValueOnce(page).mockReturnValueOnce(pending.promise)
  const observed: Array<{ root: boolean; target: boolean; text?: string }> = []
  const unsubscribe = useAppStore.subscribe((state) => { const item = state.chats.find((chat) => chat.id === "target")
    observed.push({ root: state.chats.some((chat) => chat.id === root.id), target: !!item,
      text: item?.messages[0] && "content" in item.messages[0] ? item.messages[0].content : undefined }) })
  let opening!: Promise<boolean>
  await act(async () => { opening = managed.select!("target", selection(fixture, target)); await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2)) })
  expect(cached(root.id)).toBeUndefined(); expect(cached("target")).toBeUndefined()
  await act(async () => { pending.resolve(page); expect(await opening).toBe(true) })
  unsubscribe()
  expect(cached("target")?.messages[0]).toMatchObject({ content: "cold-child" })
  expect(cached("sibling")?.title).toBe("new sibling")
  expect(observed.filter((item) => item.target).every((item) => item.root && item.text === "cold-child")).toBe(true)
  expect(useAppStore.getState().currentSessionId).toBe("target")
})

it("updates a stale Project only together with verified history", async () => {
  const { fixture, target: base, page, read } = await setup(), pending = deferred<typeof page>()
  const target = { ...base, project_id: "p2" }
  const entry = { ...fixture.sessions[0]!, session_id: target.session_id, root_session_id: target.root_session_id, current_user_target: target }
  const matching = { ...page, sessions: [entry] }
  const detail = { ...summary("target"), project_id: "p2", title: "fresh title", title_version: 2, is_running: true }
  read.mockResolvedValueOnce(matching).mockReturnValueOnce(pending.promise)
  vi.spyOn(agentClient, "getSession").mockResolvedValue({ session: detail })
  vi.spyOn(agentClient, "getHistory").mockResolvedValue(history("target", "new-project"))
  const before = cached("target")
  let opening!: Promise<boolean>
  await act(async () => { opening = managed.select!("target", selection(fixture, target)); await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2)) })
  expect(cached("target")).toEqual(before)
  await act(async () => { pending.resolve(matching); expect(await opening).toBe(true) })
  expect(cached("target")?.config.projectId).toBe("p2")
  expect(cached("target")).toMatchObject({ title: "fresh title", isRunning: true })
  expect(useAppStore.getState().executionBySession["target"]?.backend.isRunning).toBe(true)
  expect(cached("target")?.messages[0]).toMatchObject({ content: "new-project" })
  expect(useAppStore.getState().currentSessionId).toBe("target")
})

it("does not publish a cold Child when its Root tree cannot be staged", async () => {
  const { fixture, read, select } = await setup()
  const target = { ...fixture.sessions[1]!.current_user_target!, session_id: "target" }
  const entry = { ...fixture.sessions[1]!, session_id: target.session_id, current_user_target: target }
  const child: SessionSummary = { ...summary("target", target.created_at), kind: "child", root_session_id: target.root_session_id,
    parent_session_id: target.parent_session_id, project_id: target.project_id, spawn_depth: 1 }
  const root: SessionSummary = { ...summary(target.root_session_id), subagent_count: 1 }
  act(() => useAppStore.setState((state) => ({ chats: state.chats.filter((item) => item.id !== "target") })))
  read.mockResolvedValue({ ...fixture, sessions: [entry] })
  vi.spyOn(agentClient, "getSession").mockImplementation(async (id) => ({ session: id === "target" ? child : root }))
  vi.spyOn(agentClient, "listSessions").mockRejectedValue(new Error("synthetic tree unavailable"))
  const readHistory = vi.spyOn(agentClient, "getHistory").mockResolvedValue(history("target", "unavailable"))
  const before = useAppStore.getState().chats
  await act(async () => { expect(await managed.select!("target", selection(fixture, target))).toBe(false) })
  expect(useAppStore.getState().chats).toEqual(before)
  expect(readHistory).not.toHaveBeenCalled()
  expect(select).not.toHaveBeenCalled()
})


it("commits history and selection together before a later navigation", async () => {
  const { fixture, target } = await setup()
  vi.spyOn(agentClient, "getHistory").mockResolvedValue(history("target", "committed"))
  const observations: Array<string | null> = []
  let scheduled = false
  const unsubscribe = useAppStore.subscribe((state) => {
    const item = state.chats.find((chat) => chat.id === "target")
    if (!scheduled && item?.messages[0] && "content" in item.messages[0] && item.messages[0].content === "committed") {
      scheduled = true
      observations.push(state.currentSessionId)
      queueMicrotask(() => useAppStore.setState({ currentSessionId: "second" }))
    }
  })
  await act(async () => { expect(await managed.select!("target", selection(fixture, target))).toBe(true) })
  unsubscribe()
  expect(observations).toEqual(["target"])
  expect(useAppStore.getState().currentSessionId).toBe("second")
})


it("does not resurrect a cold target deleted while final verification is pending", async () => {
  const { fixture, target, page, read } = await setup(), pending = deferred<typeof page>()
  act(() => useAppStore.setState((state) => ({ chats: state.chats.filter((item) => item.id !== "target") })))
  vi.spyOn(agentClient, "getSession").mockResolvedValue({ session: summary("target") })
  vi.spyOn(agentClient, "getHistory").mockResolvedValue(history("target", "deleted"))
  vi.spyOn(agentClient, "deleteSession").mockResolvedValue(undefined)
  read.mockResolvedValueOnce(page).mockReturnValueOnce(pending.promise)
  let opening!: Promise<boolean>
  await act(async () => { opening = managed.select!("target", selection(fixture, target)); await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2)) })
  await act(async () => { await useAppStore.getState().deleteSession("target") })
  await act(async () => { pending.resolve(page); expect(await opening).toBe(false) })
  expect(cached("target")).toBeUndefined()
  expect(useAppStore.getState().currentSessionId).toBe(supervisor)
})

it("does not overwrite a newer execution event with a staged cold summary", async () => {
  const { fixture, target, page, read } = await setup(), pending = deferred<typeof page>()
  act(() => useAppStore.setState((state) => ({ chats: state.chats.filter((item) => item.id !== "target") })))
  vi.spyOn(agentClient, "getSession").mockResolvedValue({ session: { ...summary("target"), is_running: false, last_run_status: "completed" } })
  vi.spyOn(agentClient, "getHistory").mockResolvedValue(history("target", "old-summary"))
  read.mockResolvedValueOnce(page).mockReturnValueOnce(pending.promise)
  let opening!: Promise<boolean>
  await act(async () => { opening = managed.select!("target", selection(fixture, target)); await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2)) })
  act(() => { useAppStore.getState().markOptimisticStart("target") })
  const fresh = useAppStore.getState().executionBySession["target"]
  await act(async () => { pending.resolve(page); expect(await opening).toBe(false) })
  expect(useAppStore.getState().executionBySession["target"]).toBe(fresh)
  expect(cached("target")).toBeUndefined()
})

it("does not open a cached Root when its required child tree cannot be staged", async () => {
  const { fixture, target, select } = await setup()
  act(() => useAppStore.setState((state) => ({ chats: state.chats.map((item) => item.id === "target" ? { ...item, subagentCount: 1 } : item) })))
  vi.spyOn(agentClient, "getSession").mockResolvedValue({ session: { ...summary("target"), subagent_count: 1 } })
  vi.spyOn(agentClient, "listSessions").mockRejectedValue(new Error("synthetic tree unavailable"))
  const readHistory = vi.spyOn(agentClient, "getHistory").mockResolvedValue(history("target", "unavailable"))
  const before = cached("target")
  await act(async () => { expect(await managed.select!("target", selection(fixture, target))).toBe(false) })
  expect(cached("target")).toEqual(before)
  expect(readHistory).not.toHaveBeenCalled()
  expect(select).not.toHaveBeenCalled()
})


it("does not commit a cold target after a remote deletion notification", async () => {
  const { fixture, target, page, read } = await setup(), pending = deferred<typeof page>()
  act(() => useAppStore.setState((state) => ({ chats: state.chats.filter((item) => item.id !== "target") })))
  vi.spyOn(agentClient, "getSession").mockResolvedValue({ session: summary("target") })
  vi.spyOn(agentClient, "getHistory").mockResolvedValue(history("target", "deleted-remotely"))
  read.mockResolvedValueOnce(page).mockReturnValueOnce(pending.promise)
  let opening!: Promise<boolean>
  await act(async () => { opening = managed.select!("target", selection(fixture, target)); await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2)) })
  act(() => useAppStore.getState().invalidateSessionNavigation("target"))
  await act(async () => { pending.resolve(page); expect(await opening).toBe(false) })
  expect(cached("target")).toBeUndefined()
  expect(useAppStore.getState().currentSessionId).toBe(supervisor)
})


it("commits a cold Root's complete staged child tree before selecting it", async () => {
  const { fixture, target, page, read } = await setup(), pending = deferred<typeof page>()
  act(() => useAppStore.setState((state) => ({ chats: state.chats.filter((item) => item.id !== "target") })))
  const root = { ...summary("target"), subagent_count: 2 }
  const children: SessionSummary[] = ["child-one", "child-two"].map((id) => ({ ...summary(id), kind: "child", root_session_id: "target", parent_session_id: "target", spawn_depth: 1 }))
  vi.spyOn(agentClient, "getSession").mockResolvedValue({ session: root })
  vi.spyOn(agentClient, "listSessions").mockResolvedValue({ sessions: children, total: 2, limit: 200, offset: 0 })
  vi.spyOn(agentClient, "getHistory").mockResolvedValue(history("target", "root-with-tree"))
  read.mockResolvedValueOnce(page).mockReturnValueOnce(pending.promise)
  const observed: Array<{ selected: string | null; ids: string[] }> = []
  const unsubscribe = useAppStore.subscribe((state) => {
    if (state.chats.some((item) => item.id === "target")) observed.push({ selected: state.currentSessionId, ids: state.chats.map((item) => item.id) })
  })
  let opening!: Promise<boolean>
  await act(async () => { opening = managed.select!("target", selection(fixture, target)); await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2)) })
  expect(cached("target")).toBeUndefined(); expect(cached("child-one")).toBeUndefined()
  await act(async () => { pending.resolve(page); expect(await opening).toBe(true) })
  unsubscribe()
  expect(observed.length).toBeGreaterThan(0)
  expect(observed.every((item) => item.selected === "target" && item.ids.includes("child-one") && item.ids.includes("child-two"))).toBe(true)
})

it("does not reinsert a sibling removed while a cold Child is being verified", async () => {
  const { fixture, read } = await setup()
  const target = { ...fixture.sessions[1]!.current_user_target!, session_id: "target" }
  const entry = { ...fixture.sessions[1]!, session_id: target.session_id, current_user_target: target }
  const page = { ...fixture, sessions: [entry] }, pending = deferred<typeof page>()
  const child: SessionSummary = { ...summary("target", target.created_at), kind: "child", root_session_id: target.root_session_id,
    parent_session_id: target.parent_session_id, project_id: target.project_id, spawn_depth: 1 }
  const root: SessionSummary = { ...summary(target.root_session_id), subagent_count: 2 }
  const sibling: SessionSummary = { ...child, id: "sibling" }
  act(() => useAppStore.setState((state) => ({ chats: [...state.chats.filter((item) => item.id !== "target"), sessionSummaryToChatItem(root), sessionSummaryToChatItem(sibling)] })))
  vi.spyOn(agentClient, "getSession").mockImplementation(async (id) => ({ session: id === "target" ? child : root }))
  vi.spyOn(agentClient, "listSessions").mockResolvedValue({ sessions: [child, sibling], total: 2, limit: 200, offset: 0 })
  vi.spyOn(agentClient, "getHistory").mockResolvedValue(history("target", "staged"))
  read.mockResolvedValueOnce(page).mockReturnValueOnce(pending.promise)
  let opening!: Promise<boolean>
  await act(async () => { opening = managed.select!("target", selection(fixture, target)); await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2)) })
  act(() => useAppStore.setState((state) => ({ chats: state.chats.filter((item) => item.id !== "sibling") })))
  await act(async () => { pending.resolve(page); expect(await opening).toBe(false) })
  expect(cached("sibling")).toBeUndefined()
  expect(cached("target")).toBeUndefined()
  expect(useAppStore.getState().currentSessionId).toBe(supervisor)
})


it.each([false, true])("only reconciles staged Child permission hints after successful commit: %s", async (accepted) => {
  const { fixture, target, page, read } = await setup(), pending = deferred<typeof page>()
  const childId = `permission-child-${accepted}`
  const root: SessionSummary = { ...summary("target"), subagent_count: 1 }
  const child: SessionSummary = { ...summary(childId), kind: "child", root_session_id: "target", parent_session_id: "target", spawn_depth: 1, permission_mode: "bypass" }
  const cachedChild = sessionSummaryToChatItem({ ...child, permission_mode: "default" })
  cachedChild.config.permissionModeEtag = '"7"'
  act(() => useAppStore.setState((state) => ({ chats: [...state.chats.filter((item) => item.id !== "target"), cachedChild],
    permissionModeRequests: { ...state.permissionModeRequests, [childId]: { status: "ready", operationId: 1 } } })))
  vi.spyOn(agentClient, "getSession").mockResolvedValue({ session: root })
  vi.spyOn(agentClient, "listSessions").mockResolvedValue({ sessions: [child], total: 1, limit: 200, offset: 0 })
  vi.spyOn(agentClient, "getHistory").mockResolvedValue(history("target", "root"))
  const permission = deferred<{ sessionId: string; mode: "bypass"; etag: string }>()
  const getPermission = vi.spyOn(agentClient, "getSessionPermissionMode").mockReturnValue(permission.promise)
  read.mockResolvedValueOnce(page).mockReturnValueOnce(pending.promise)
  let opening!: Promise<boolean>
  await act(async () => { opening = managed.select!("target", selection(fixture, target)); await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2)) })
  expect(getPermission).not.toHaveBeenCalled()
  const changed = { ...target, created_at: "2026-10-28T00:00:00Z" }
  const rejected = { ...page, sessions: [{ ...page.sessions[0]!, current_user_target: changed }] }
  await act(async () => { pending.resolve(accepted ? page : rejected); expect(await opening).toBe(accepted) })
  if (accepted) {
    await vi.waitFor(() => expect(getPermission).toHaveBeenCalledExactlyOnceWith(childId))
    await act(async () => { permission.resolve({ sessionId: childId, mode: "bypass", etag: '"8"' }); await permission.promise })
    await vi.waitFor(() => expect(cached(childId)?.config.permissionMode).toBe("bypass"))
  } else expect(getPermission).not.toHaveBeenCalled()
  useAppStore.getState().resetSessionPermissionModes([childId])
})

it("updates an existing Root's child count before opening and later hydrating a cold Child", async () => {
  const { fixture, read } = await setup()
  const target = { ...fixture.sessions[1]!.current_user_target!, session_id: "target" }
  const entry = { ...fixture.sessions[1]!, session_id: target.session_id, current_user_target: target }
  const child: SessionSummary = { ...summary("target", target.created_at), kind: "child", root_session_id: target.root_session_id,
    parent_session_id: target.parent_session_id, project_id: target.project_id, spawn_depth: 1 }
  const root: SessionSummary = { ...summary(target.root_session_id), subagent_count: 1 }
  const oldRoot = sessionSummaryToChatItem({ ...root, subagent_count: 0 })
  act(() => useAppStore.setState((state) => ({ chats: [...state.chats.filter((item) => item.id !== "target"), oldRoot] })))
  read.mockResolvedValue({ ...fixture, sessions: [entry] })
  vi.spyOn(agentClient, "getSession").mockImplementation(async (id) => ({ session: id === "target" ? child : root }))
  vi.spyOn(agentClient, "listSessions").mockResolvedValue({ sessions: [child], total: 1, limit: 200, offset: 0 })
  vi.spyOn(agentClient, "getHistory").mockResolvedValue(history("target", "child"))
  await act(async () => { expect(await managed.select!("target", selection(fixture, target))).toBe(true) })
  expect(cached(root.id)?.subagentCount).toBe(1)
  await act(async () => { await useAppStore.getState().loadSubagentSessions("target", { force: true }) })
  expect(cached("target")?.messages[0]).toMatchObject({ content: "child" })
  expect(useAppStore.getState().currentSessionId).toBe("target")
})


it("opens managed history through the bound reader without the generic history fallback", async () => {
  const { fixture, target } = await setup()
  const bound = vi.mocked(managedSessionsClient.readBoundHistory).mockResolvedValue(history("target", "bound"))
  const generic = vi.spyOn(agentClient, "getHistory")
  await act(async () => { expect(await managed.select!("target", selection(fixture, target))).toBe(true) })
  expect(bound).toHaveBeenCalledExactlyOnceWith(selection(fixture, target))
  expect(generic).not.toHaveBeenCalled()
  expect(cached("target")?.messages[0]).toMatchObject({ content: "bound" })
})

it("leaves navigation and cache untouched when the bound history request is refused", async () => {
  const { fixture, target } = await setup()
  vi.mocked(managedSessionsClient.readBoundHistory).mockRejectedValue(new Error("target changed"))
  const generic = vi.spyOn(agentClient, "getHistory"), before = cached("target")
  await act(async () => { await expect(managed.select!("target", selection(fixture, target))).rejects.toThrow("target changed") })
  expect(generic).not.toHaveBeenCalled()
  expect(cached("target")).toEqual(before)
  expect(useAppStore.getState().currentSessionId).toBe(supervisor)
})
