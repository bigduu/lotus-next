// Actual native Child/Host HTTP and WebSocket acceptance. No API or socket is
// intercepted, fulfilled, injected, or replaced by a browser-side fixture.
import { expect, test } from "@playwright/test"
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { parseActorChannelFrame } from "../src/services/chat/actorChannel.js"
interface ActorSubtreeSnapshot {
  schema_version: number
  root_actor_id: string
  subtree_actor_id: string
  stream_cursor: string | null
  nodes: { actor_id: string; title: string; activation: { status: string } | null }[]
}

interface Fixture {
  schema_version: 1
  origin: string
  api: string
  root_id: string
  child_id: string
  activation_id: string
  attempt: number
  release: string
  completed: string
  restart: string
  restarted: string
  done: string
}
type Frame = Record<string, unknown>
interface ObservedFrame { socket: number; direction: "sent" | "received"; raw: string; value: Frame }
const signal = (path: string, value: unknown) => {
  writeFileSync(path + ".pending", JSON.stringify(value))
  renameSync(path + ".pending", path)
}

test("one native Child: real Actor/tree invalidation, isolated history and honest restart gap", async ({ page }, testInfo) => {
  const info = process.env.LOTUS_ACTOR_FIXTURE_INFO!
  await expect.poll(() => existsSync(info), { timeout: 60_000, message: "native authority checks reach the held provider cut" }).toBe(true)
  const fixture = JSON.parse(readFileSync(info, "utf8")) as Fixture
  expect(fixture.schema_version).toBe(1)
  const { root_id: root, child_id: child } = fixture
  const actor = `actor.${child}`, tree = `tree.${root}`, message = `message.${child}`
  const frames: ObservedFrame[] = [], requests: string[] = [], snapshots: ActorSubtreeSnapshot[] = []
  const sockets: { url: string; closed: boolean }[] = []
  const errors: string[] = [], historyReceipts: { count: number; answers: number }[] = []
  const snapshotPath = `/api/v1/actors/${root}/snapshot`
  const historyPath = `/api/v1/sessions/${child}/history`
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("request", (request) => requests.push(request.url()))
  page.on("response", async (response) => {
    const url = new URL(response.url())
    if (!response.ok() || ![snapshotPath, historyPath].includes(url.pathname)) return
    try {
      const body = await response.json()
      if (url.pathname === snapshotPath) snapshots.push(body as ActorSubtreeSnapshot)
      else historyReceipts.push({ count: body.messages.length,
        answers: body.messages.filter((m: { role: string; content: string }) => m.role === "assistant" && m.content === "F2_CHILD_COMPLETED").length })
    } catch { /* A response interrupted by the deliberate Host restart is not a receipt. */ }
  })
  page.on("websocket", (socket) => {
    const index = sockets.push({ url: socket.url(), closed: false }) - 1
    socket.on("close", () => { sockets[index].closed = true })
    const observe = (direction: "sent" | "received", payload: string | Buffer) => {
        try {
          const value = JSON.parse(String(payload)) as Frame
          // Keep only public Actor/tree envelopes and body-free subscription
          // receipts. Never export hello credentials or message bodies.
          if (direction === "sent" && ["subscribe", "subscribe_tree", "unsubscribe"].includes(String(value.type)) ||
            direction === "received" && [actor, tree].includes(String(value.ch))) {
            frames.push({ socket: index, direction, raw: String(payload), value })
          }
        } catch { errors.push("non-JSON frame on the default JSON transport") }
    }
    socket.on("framesent", ({ payload }) => observe("sent", payload))
    socket.on("framereceived", ({ payload }) => observe("received", payload))
  })
  const sent = (type: string, channel: string, socket?: number) => frames.filter((f) => f.direction === "sent" && f.value.type === type && f.value.ch === channel && (socket === undefined || f.socket === socket))
  const actorFrames = () => frames.filter((f) => f.direction === "received" && f.value.ch === actor)
  const childNode = (snapshot: ActorSubtreeSnapshot) => snapshot.nodes.find((n) => n.actor_id === child)
  const assertProjectedChildOnly = () => {
    expect(requests.filter((u) => new URL(u).pathname === `/api/v1/history/${child}`)).toHaveLength(0)
    expect(sent("subscribe", `agent.${child}`)).toHaveLength(0)
    expect(requests.filter((u) => new URL(u).pathname === historyPath).every((u) => new URL(u).searchParams.get("projection") === "messages")).toBe(true)
  }
  const assertPublicActorFrames = () => {
    for (const f of actorFrames()) {
      const decoded = parseActorChannelFrame(f.value, child)
      expect(decoded, "strict Actor DTO rejects private fields and unknown shapes").not.toBeNull()
      if (decoded?.type === "event") expect(decoded.event).toMatchObject({ actor_id: child, root_actor_id: root,
        parent_actor_id: root, activation_id: fixture.activation_id, attempt: fixture.attempt })
    }
  }
  const inspect = page.locator("[data-actor-snapshot-panel]")
  const workbench = page.locator("#right-workbench")
  const transcript = workbench.locator("[data-subagent-transcript-pane]")
  try {
    await page.addInitScript(({ origin, root }) => {
      localStorage.setItem("bodhi_onboarded_v1", "1")
      localStorage.setItem("lotus_next_backend_endpoint_v1", origin)
      localStorage.setItem("lotus_next_last_session", root)
    }, { origin: fixture.origin, root })
    // The welcome flag does not complete the real backend's first-run setup.
    // Exercise its ordinary UI action and verify persistence without fixtures.
    const setupPath = "/api/v1/bamboo/setup/status"
    const initialSetup = page.waitForResponse((response) => new URL(response.url()).pathname === setupPath)
    await page.goto(fixture.origin)
    const initialSetupResponse = await initialSetup
    expect(initialSetupResponse.ok()).toBe(true)
    expect((await initialSetupResponse.json()).is_complete).toBe(false)
    await expect(page.getByRole("heading", { name: "首次设置", exact: true })).toBeVisible()
    const completedSetup = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/bamboo/setup/complete" && response.request().method() === "POST")
    await page.getByRole("button", { name: "已完成，继续", exact: true }).click()
    const completedSetupResponse = await completedSetup
    expect(completedSetupResponse.ok()).toBe(true)
    expect((await completedSetupResponse.json()).success).toBe(true)
    const setupStatus = await page.request.get(fixture.origin + setupPath)
    expect(setupStatus.ok()).toBe(true)
    expect((await setupStatus.json()).is_complete).toBe(true)
    await expect(page.getByRole("button", { name: "打开侧边面板" })).toBeVisible()
    await page.getByRole("button", { name: "打开侧边面板" }).click()
    await workbench.getByRole("button", { name: /检查器.*查看当前会话/ }).click()
    await expect(inspect.getByRole("tree")).toBeVisible()
    await expect.poll(() => snapshots.some((s) => childNode(s)?.activation?.status === "running")).toBe(true)
    const initial = snapshots.find((s) => childNode(s)?.activation?.status === "running")!
    expect(initial.schema_version).toBe(1)
    expect(initial.root_actor_id).toBe(root)
    expect(initial.subtree_actor_id).toBe(root)
    expect(initial.nodes.map((n) => n.actor_id).sort()).toEqual([root, child].sort())
    expect(childNode(initial)).toMatchObject({ root_actor_id: root, parent_actor_id: root, role: "child", depth: 1,
      placement_class: "local", activation: { activation_id: fixture.activation_id, attempt: fixture.attempt, status: "running" } })
    await expect.poll(() => sent("subscribe_tree", tree).length).toBeGreaterThan(0)
    const rootRow = inspect.locator(`[data-actor-id="${root}"]`)
    // Collapse and expand the actual Root; topology interest alone must not
    // request the Child's transcript or create Child content/Actor interest.
    if (await rootRow.getAttribute("aria-expanded") === "true") await rootRow.locator("[data-actor-toggle]").click()
    await rootRow.locator("[data-actor-toggle]").click()
    await expect(inspect.locator(`[data-actor-id="${child}"]`)).toBeVisible()
    expect(requests.filter((u) => new URL(u).pathname === historyPath)).toHaveLength(0)
    expect(sent("subscribe", actor)).toHaveLength(0)
    expect(sent("subscribe", message)).toHaveLength(0)
    assertProjectedChildOnly()
    expect(sockets).toHaveLength(1)
    await page.screenshot({ path: testInfo.outputPath("native-running-tree.png") })

    await inspect.locator(`[data-actor-id="${child}"]`).click()
    await expect(transcript).toBeVisible()
    await expect.poll(() => sent("subscribe", actor).length, { message: "selected Child requires canonical Actor interest" }).toBe(1)
    await expect.poll(() => sent("subscribe", message).length).toBe(1)
    await expect.poll(() => actorFrames().some((f) => parseActorChannelFrame(f.value, child)?.type === "control")).toBe(true)
    await expect.poll(() => historyReceipts.length).toBeGreaterThan(0)
    expect(sockets).toHaveLength(1)
    expect(sent("subscribe", actor)[0].socket).toBe(sent("subscribe", message)[0].socket)
    assertProjectedChildOnly()

    const releaseFrame = frames.length, releaseSnapshot = snapshots.length
    signal(fixture.release, { release: true })
    await expect.poll(() => frames.slice(releaseFrame).some((f) => f.direction === "received" && f.value.ch === actor && parseActorChannelFrame(f.value, child)?.type === "event"),
      { timeout: 45_000, message: "native producer must emit a real body-free actor_changed, not only legacy messages" }).toBe(true)
    assertPublicActorFrames()
    await expect.poll(() => snapshots.slice(releaseSnapshot).some((s) => childNode(s)?.activation?.status === "succeeded")).toBe(true)
    await expect(transcript.getByText("F2_CHILD_COMPLETED", { exact: true })).toHaveCount(1)
    await expect.poll(() => existsSync(fixture.completed), { timeout: 45_000 }).toBe(true)
    expect(JSON.parse(readFileSync(fixture.completed, "utf8"))).toMatchObject({ completed: true, held_cut_runs: 1, child_provider_calls: 1 })
    await page.screenshot({ path: testInfo.outputPath("native-completed-child.png") })

    // Actor invalidation refreshes immediately and can supersede the tree poll
    // for that same completion. A settled Root-only metadata change proves the
    // independent tree path without racing or muting the selected Child observer.
    await page.waitForTimeout(2_100) // One documented Host tree polling interval.
    const readSnapshot = async () => {
      const response = await page.request.get(`${fixture.api}/actors/${root}/snapshot?subtree_id=${root}`)
      expect(response.ok(), await response.text()).toBe(true)
      return response.json() as Promise<ActorSubtreeSnapshot>
    }
    const cursor = (value: unknown) => {
      const match = typeof value === "string" ? /^at1-([0-9a-f]{64})-([1-9][0-9]*)$/.exec(value) : null
      expect(match, "canonical tree cursor").not.toBeNull()
      return { scope: match![1], revision: BigInt(match![2]) }
    }
    const title = "NATIVE_ACTOR_TREE_COMPLETED"
    const prePatch = await readSnapshot()
    expect(childNode(prePatch)?.activation?.status).toBe("succeeded")
    expect(prePatch.nodes.find((n) => n.actor_id === root)?.title).not.toBe(title)
    const beforeTitle = cursor(prePatch.stream_cursor)
    const treeFrame = frames.length, treeSnapshot = snapshots.length
    const renamed = await page.request.patch(`${fixture.api}/sessions/${root}`, { data: { title } })
    expect(renamed.ok(), await renamed.text()).toBe(true)
    const postPatch = await readSnapshot()
    expect(postPatch.nodes.find((n) => n.actor_id === root)?.title).toBe(title)
    expect(childNode(postPatch)?.activation?.status).toBe("succeeded")
    const titleCommitted = cursor(postPatch.stream_cursor)
    expect(titleCommitted.scope).toBe(beforeTitle.scope)
    expect(titleCommitted.revision).toBeGreaterThan(beforeTitle.revision)
    const changedTitle = () => frames.slice(treeFrame).find((f) => {
      if (f.direction !== "received" || f.value.ch !== tree ||
        (f.value.control as Frame | undefined)?.type !== "actor_snapshot_required" ||
        (f.value.control as Frame).reason !== "changed") return false
      const required = cursor((f.value.control as Frame).cursor)
      expect(required.scope).toBe(beforeTitle.scope)
      return required.revision > beforeTitle.revision && required.revision >= titleCommitted.revision
    })
    // A delayed completion control cannot satisfy the Root-title gate.
    await expect.poll(() => !!changedTitle()).toBe(true)
    const required = cursor((changedTitle()!.value.control as Frame).cursor)
    await expect.poll(() => snapshots.slice(treeSnapshot).some((s) => {
      if (s.nodes.find((n) => n.actor_id === root)?.title !== title) return false
      const observed = cursor(s.stream_cursor)
      return observed.scope === required.scope && observed.revision >= required.revision &&
        childNode(s)?.activation?.status === "succeeded"
    })).toBe(true)

    // The Inspector owns the selected Child during restart. Its retained Actor
    // warning is separate from the projected history and tree snapshot domains.
    const inspectorFrame = frames.length
    await workbench.getByRole("tab", { name: "检查器", exact: true }).click()
    await expect(inspect.locator(`[data-actor-id="${child}"]`)).toHaveAttribute("aria-selected", "true")
    await expect.poll(() => sent("unsubscribe", message).length).toBeGreaterThan(0)
    await expect(inspect).toHaveAttribute("aria-busy", "false")
    await expect.poll(() => frames.slice(inspectorFrame).some((f) => f.direction === "sent" && f.value.type === "subscribe" && f.value.ch === actor)).toBe(true)
    await expect.poll(() => {
      const lastSubscribe = frames.findLastIndex((f) => f.direction === "sent" && f.value.type === "subscribe" && f.value.ch === actor)
      return frames.slice(lastSubscribe + 1).some((f) => f.direction === "received" && f.value.ch === actor && parseActorChannelFrame(f.value, child)?.type === "control")
    }, { message: "new Inspector Actor interest has a numeric cursor before restart" }).toBe(true)
    const expectedSince = actorFrames().at(-1)!.value.seq
    const restartFrame = frames.length, restartSnapshot = snapshots.length
    signal(fixture.restart, { restart: true })
    await expect.poll(() => existsSync(fixture.restarted), { timeout: 45_000 }).toBe(true)
    await expect.poll(() => sockets.some((s) => s.closed)).toBe(true)
    await expect.poll(() => frames.slice(restartFrame).some((f) => f.direction === "sent" && f.value.type === "subscribe" &&
      f.value.ch === actor && typeof f.value.since === "number" && f.value.since === expectedSince), { timeout: 45_000 }).toBe(true)
    await expect.poll(() => frames.slice(restartFrame).some((f) => f.direction === "received" && f.value.ch === actor &&
      parseActorChannelFrame(f.value, child)?.type === "control" && (f.value.control as Frame).reason === "gap")).toBe(true)
    const gap = inspect.locator(`[data-actor-gap="transport_gap"][data-actor-gap-origin="${child}"]`)
    await expect(gap).toBeVisible()
    await expect.poll(() => snapshots.slice(restartSnapshot).some((s) => childNode(s)?.activation?.status === "succeeded")).toBe(true)
    const priorReads = snapshots.length
    await inspect.getByRole("button", { name: "刷新代理结构" }).click()
    await expect.poll(() => snapshots.length).toBeGreaterThan(priorReads)
    await expect(inspect).toHaveAttribute("aria-busy", "false")
    const history = await page.evaluate(async (url) => {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`history status ${response.status}`)
      return response.json() as Promise<{ messages: { role: string; content: string }[] }>
    }, fixture.api + `/sessions/${child}/history?projection=messages`)
    expect(history.messages.filter((m: { role: string; content: string }) => m.role === "assistant" && m.content === "F2_CHILD_COMPLETED")).toHaveLength(1)
    await expect(gap, "successful tree and history reads cannot claim Actor replay recovery").toBeVisible()
    await expect(gap).toContainText(child)
    await page.screenshot({ path: testInfo.outputPath("native-restart-child-gap.png") })
    expect(sockets.filter((s) => !s.closed)).toHaveLength(1)
    expect(sockets.every((s) => new URL(s.url).pathname === "/v2/stream")).toBe(true)

    const cleanupFrame = frames.length
    await inspect.locator(`[data-actor-id="${root}"]`).click()
    await expect.poll(() => frames.slice(cleanupFrame).some((f) => f.direction === "sent" && f.value.type === "unsubscribe" && f.value.ch === actor)).toBe(true)
    await workbench.getByRole("button", { name: "收起工作面板", exact: true }).click()
    await expect.poll(() => frames.slice(cleanupFrame).some((f) => f.direction === "sent" && f.value.type === "unsubscribe" && f.value.ch === tree)).toBe(true)
    await page.getByRole("button", { name: "打开侧边面板" }).click()
    if (!await inspect.isVisible()) await workbench.getByRole("tab", { name: "检查器", exact: true }).click()
    await expect(inspect.locator(`[data-actor-id="${child}"]`)).toBeVisible()
    await inspect.locator(`[data-actor-id="${child}"]`).click()
    await expect(transcript.getByText("F2_CHILD_COMPLETED", { exact: true })).toHaveCount(1)
    assertProjectedChildOnly()
    assertPublicActorFrames()
    expect(errors).toEqual([])
    signal(fixture.done, { pass: true, actor_id: child, real_actor_frames: actorFrames().length, historical_answers: 1 })
  } catch (error) {
    signal(fixture.done, { pass: false, error: String(error) })
    throw error
  } finally {
    await testInfo.attach("native-actor-wire-receipts", { body: JSON.stringify({ frames, snapshots,
      history: historyReceipts, sockets, page_errors: errors }, null, 2), contentType: "application/json" })
  }
})
