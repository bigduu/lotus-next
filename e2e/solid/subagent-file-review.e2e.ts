import { expect, test, type WebSocketRoute } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "../support/artifactRuntime.js"

const root = "all-surface-session"
const worker = "actor-0"
const nested = "actor-1"
const otherRoot = "other-root"
const otherWorker = "other-worker"
const emptyChildren = ["actor-2", "actor-3", "actor-4", "actor-5"]
const createdAt = "2026-11-22T00:00:00Z"
const completedAt = "2026-11-22T00:01:00Z"

function edit(id: string, filePath: string, added: string, at = createdAt) {
  return {
    id, role: "tool", tool_call_id: "shared-provider-call", tool_success: true, created_at: at,
    content: JSON.stringify({
      operation: "Edit", file_path: filePath,
      diff: { unified: `--- a/file\n+++ b/file\n@@ -0,0 +1 @@\n+${added}`, added_lines: 1, removed_lines: 0 },
    }),
  }
}

test("Solid Root Review bounds child histories and retains valid nested edits across independent reads", async ({ page, baseURL, isMobile }) => {
  const entryUrl = new URL("/", baseURL).href
  await page.addInitScript((id) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_ui_locale_v1", "en-US")
    if (!localStorage.getItem("lotus_next_last_session")) localStorage.setItem("lotus_next_last_session", id)
  }, root)
  const observation = await installArtifactRuntime(page, {
    ...standaloneScenario, origin: new URL(entryUrl).origin, entryUrl,
  }, [], { serveStaticFromLocalServer: true })

  let committed = false
  let nestedAvailable = false
  let refreshNested = false
  let feed: WebSocketRoute | undefined
  let treeReads = 0
  const childReads: string[] = []
  const firstBatch = Promise.withResolvers<void>()
  const nestedHistory = Promise.withResolvers<void>()
  const lateHistory = Promise.withResolvers<void>()
  const session = (id: string, title: string, rootId: string, parent: string | null, workspace: string) => ({
    id, title, title_version: id === nested && refreshNested ? 2 : 1,
    kind: parent ? "child" : "root",
    parent_session_id: parent, root_session_id: rootId, spawn_depth: parent ? parent === worker ? 2 : 1 : 0,
    pinned: false, is_running: false, workspace_path: workspace, placement: { kind: "local", host: "fixture" },
    model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
    created_at: createdAt, updated_at: committed && id === worker ? completedAt : createdAt,
    message_count: id === worker && committed ? 2 : 1,
    subagent_count: parent ? 0 : id === root ? emptyChildren.length + 2 : 1,
    permission_mode: "default", bypass_permissions: false, root_orchestration_only: false,
    thinking_mode: "standard", root_mode_transition_epoch: 0, root_mode_birth_token: "a".repeat(64),
  })
  const summaries = () => [
    session(root, "Root with edits", root, null, "/main"),
    session(worker, "File worker", root, root, "/main"),
    session(nested, refreshNested ? "Updated nested worker" : "Nested worker", root, worker, "/isolated"),
    ...emptyChildren.map((id) => session(id, id, root, root, "/main")),
    session(otherRoot, "Other Root", otherRoot, null, "/other"),
    session(otherWorker, "Other worker", otherRoot, otherRoot, "/other"),
  ]
  await page.routeWebSocket(/.*/, (socket) => {
    socket.onMessage((message) => {
      const frame = JSON.parse(String(message)) as { type: string; ch?: string }
      if (frame.type === "hello") socket.send(JSON.stringify({ type: "welcome" }))
      if (frame.type === "ping") socket.send(JSON.stringify({ type: "pong" }))
      if (frame.type === "subscribe" && frame.ch === "feed") feed = socket
    })
  })
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() !== "GET") return route.fallback()
    if (url.pathname === "/api/v1/sessions") {
      const kind = url.searchParams.get("kind")
      const rootId = url.searchParams.get("root_session_id")
      if (kind === "child" && rootId === root) treeReads += 1
      const sessions = summaries().filter((item) => item.kind === kind && (!rootId || item.root_session_id === rootId))
      return route.fulfill({ json: { sessions, total: sessions.length, limit: 200, offset: 0 } })
    }
    for (const item of summaries()) {
      const { id } = item
      if (url.pathname === `/api/v1/sessions/${id}`) {
        return route.fulfill({ json: { session: item }, headers: { ETag: '"1"' } })
      }
      if (url.pathname !== `/api/v1/history/${id}`) continue
      if (item.kind === "child") {
        childReads.push(id)
        await firstBatch.promise
      }
      if (id === nested) {
        if (!nestedAvailable) {
          return route.fulfill({ json: { session_id: otherWorker, messages: [edit("result", "wrong.txt", "Wrong-session data")] } })
        }
        if (refreshNested) {
          await lateHistory.promise
          return route.fulfill({ json: { session_id: nested, messages: [edit("late", "/isolated/late.txt", "Late nested edit")] } })
        }
        await nestedHistory.promise
      }
      const messages = id === root ? [edit("result", "/main/shared.txt", "root edit")]
        : id === worker && committed ? [edit("result", "shared.txt", "child edit", completedAt)]
        : id === nested ? [edit("result", "shared.txt", "nested worktree edit")]
        : id === otherWorker ? [edit("result", "other.txt", "other tree edit")]
        : []
      return route.fulfill({ json: { session_id: id, messages, truncated: id === nested } })
    }
    return route.fallback()
  })

  try {
    const workbench = page.locator("#right-workbench")
    const openReview = async () => {
      if (!await workbench.isVisible()) await page.getByRole("button", { name: "Open side panel", exact: true }).click()
      const tab = workbench.getByRole("tab", { name: "Review", exact: true })
      if (await tab.isVisible()) await tab.click()
      else {
        await workbench.getByRole("button", { name: "Open workbench tab", exact: true }).click()
        await page.getByRole("menuitem", { name: "Review", exact: true }).click()
      }
      await expect(tab).toHaveAttribute("aria-selected", "true")
    }
    const review = workbench.getByRole("tabpanel", { name: "Review", exact: true })
    await page.goto(entryUrl)
    await expect.poll(() => treeReads).toBeGreaterThan(0)
    expect(childReads).toEqual([])
    await openReview()
    await expect.poll(() => childReads.length).toBe(4)
    expect(new Set(childReads).size).toBe(4)
    expect(childReads).not.toContain(otherWorker)

    firstBatch.resolve()
    await expect(review.getByText("Some subagent file changes could not be loaded.", { exact: true })).toBeVisible()
    await expect.poll(() => new Set(childReads).size).toBe(6)
    await expect(review.getByText("Wrong-session data", { exact: false })).toHaveCount(0)
    nestedAvailable = true
    await review.getByRole("button", { name: "Retry", exact: true }).click()
    const nestedReads = () => childReads.filter((id) => id === nested).length
    await expect.poll(nestedReads).toBe(2)

    await expect.poll(() => feed !== undefined).toBe(true)
    committed = true
    feed!.send(JSON.stringify({ ch: "feed", seq: 1, event: { seq: 1, ts: completedAt, session_id: worker,
      event: { type: "session_history_committed", session_id: worker } } }))
    await expect(review.getByText("1 file · 2 changes", { exact: true })).toBeVisible()
    nestedHistory.resolve()
    await expect(review.getByText("2 files · 3 changes", { exact: true })).toBeVisible()
    await expect(review.getByText("Earlier changes may be missing from long subagent histories.", { exact: true })).toBeVisible()
    expect(nestedReads()).toBe(2)
    const mainFile = review.locator("details").filter({ has: page.locator('[title="/main/shared.txt"]') })
    if (await mainFile.getAttribute("open") === null) await mainFile.locator("summary").click()
    await expect(mainFile.getByText("Subagent: File worker", { exact: true })).toBeVisible()
    await expect(mainFile.getByRole("row", { name: "+root edit", exact: true })).toBeVisible()
    await expect(mainFile.getByRole("row", { name: "+child edit", exact: true })).toBeVisible()
    const nestedFile = review.locator("details").filter({ has: page.locator('[title="/isolated/shared.txt"]') })
    if (await nestedFile.getAttribute("open") === null) await nestedFile.locator("summary").click()
    await expect(nestedFile.getByText("Subagent: Nested worker", { exact: true })).toBeVisible()

    await workbench.getByRole("button", { name: "Collapse workbench", exact: true }).click()
    await openReview()
    await expect(review.getByText("2 files · 3 changes", { exact: true })).toBeVisible()
    expect(nestedReads()).toBe(2)

    refreshNested = true
    feed!.send(JSON.stringify({ ch: "feed", seq: 2, event: { seq: 2, ts: completedAt, session_id: nested,
      event: { type: "session_title_updated", session_id: nested, title_version: 2, title: "Updated nested worker" } } }))
    await expect.poll(nestedReads).toBe(3)

    if (isMobile) {
      await workbench.getByRole("button", { name: "Collapse workbench", exact: true }).click()
      await page.getByRole("button", { name: "Menu", exact: true }).click()
    }
    await page.getByRole("button", { name: "Other Root", exact: true }).click()
    expect(childReads).not.toContain(otherWorker)
    await openReview()
    await expect(review.getByText("other.txt", { exact: true })).toBeVisible()
    lateHistory.resolve()
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await expect(review.getByText("other.txt", { exact: true })).toBeVisible()
    await expect(review.getByText(/(?:shared|late)\.txt/)).toHaveCount(0)
    expect(observation.pageErrors).toEqual([])
  } finally {
    firstBatch.resolve()
    nestedHistory.resolve()
    lateHistory.resolve()
  }
})
