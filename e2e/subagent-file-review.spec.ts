import { expect, test, type WebSocketRoute } from "@playwright/test"
import { actorSnapshotFixture } from "../src/test/fixtures/actorSnapshot.js"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const root = "all-surface-session"
const worker = "actor-0"
const nested = "actor-1"
const otherRoot = "other-root"
const otherWorker = "other-worker"
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

test("Root Review combines durable edits from a child and a nested child in the right worktrees", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-chromium", "Workbench and Environment acceptance")
  await page.addInitScript((id) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_ui_locale_v1", "en-US")
    if (!localStorage.getItem("lotus_next_last_session")) localStorage.setItem("lotus_next_last_session", id)
  }, root)
  const observation = await installArtifactRuntime(page, standaloneScenario)

  let committed = false
  let nestedAvailable = false
  let feed: WebSocketRoute | undefined
  let treeReads = 0
  const childReads: string[] = []
  const session = (id: string, title: string, rootId: string, parent: string | null, workspace: string) => ({
    id, title, title_version: 1, kind: parent ? "child" : "root",
    parent_session_id: parent, root_session_id: rootId, spawn_depth: parent ? parent === worker ? 2 : 1 : 0,
    pinned: false, is_running: false, workspace_path: workspace, placement: { kind: "local", host: "fixture" },
    model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
    created_at: createdAt, updated_at: committed && id === worker ? completedAt : createdAt,
    message_count: id === worker && committed ? 2 : 1, subagent_count: parent ? 0 : id === root ? 2 : 1,
    permission_mode: "default", bypass_permissions: false, root_orchestration_only: false,
    thinking_mode: "standard", root_mode_transition_epoch: 0, root_mode_birth_token: "a".repeat(64),
  })
  const summaries = () => [
    session(root, "Root with edits", root, null, "/main"),
    session(worker, "File worker", root, root, "/main"),
    session(nested, "Nested worker", root, worker, "/isolated"),
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
      if (url.pathname === `/api/v1/history/${id}`) {
        if (item.kind === "child") childReads.push(id)
        if (id === nested && !nestedAvailable) return route.fulfill({ status: 404, json: { error: "not readable yet" } })
        const messages = id === root ? [edit("result", "/main/shared.txt", "root edit")]
          : id === worker && committed ? [edit("result", "shared.txt", "child edit", completedAt)]
          : id === nested ? [edit("result", "shared.txt", "nested worktree edit")]
          : id === otherWorker ? [edit("result", "other.txt", "other tree edit")]
          : []
        return route.fulfill({ json: { session_id: id, messages } })
      }
      if (url.pathname === `/api/v1/task/${id}`) return route.fulfill({ json: { session_id: id, items: [] } })
      if (url.pathname === `/api/v1/actors/${id}/snapshot`) {
        return route.fulfill({ json: actorSnapshotFixture(id, item.subagent_count) })
      }
    }
    return route.fallback()
  })

  const workbench = page.locator("#right-workbench")
  const openTool = async (name: string) => {
    await workbench.getByRole("button", { name: "Open workbench tab" }).click()
    await page.getByRole("menuitem", { name, exact: true }).click()
  }
  await page.goto(standaloneScenario.entryUrl)
  await expect.poll(() => treeReads).toBeGreaterThan(0)
  expect(childReads).toEqual([])
  await page.getByRole("button", { name: "Open Environment" }).click()
  const changes = page.getByRole("region", { name: "Environment" }).getByRole("button", { name: /Changes/ })
  await expect(changes).toContainText("1 changed file")
  await changes.click()
  const review = workbench.getByRole("tabpanel", { name: "Review" })
  await expect(review.getByText("Some subagent file changes could not be loaded.")).toBeVisible()
  expect(childReads).not.toContain(otherWorker)
  nestedAvailable = true
  await review.getByRole("button", { name: "Retry" }).click()
  await expect(review.getByText("2 files · 2 changes")).toBeVisible()

  await expect.poll(() => feed !== undefined).toBe(true)
  committed = true
  feed!.send(JSON.stringify({ ch: "feed", seq: 1, event: { seq: 1, ts: completedAt, session_id: worker,
    event: { type: "session_history_committed", session_id: worker } } }))
  await expect(review.getByText("2 files · 3 changes")).toBeVisible()
  const mainFile = review.locator("details").filter({ has: page.locator('[title="/main/shared.txt"]') })
  if (await mainFile.getAttribute("open") === null) await mainFile.locator("summary").click()
  await expect(mainFile.getByText("Subagent: File worker")).toBeVisible()
  await expect(mainFile.getByRole("row", { name: "+root edit", exact: true })).toBeVisible()
  await expect(mainFile.getByRole("row", { name: "+child edit", exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath("root-subagent-file-review.png"), animations: "disabled" })

  await workbench.getByRole("button", { name: "Collapse workbench" }).click()
  await expect(changes).toContainText("2 changed files")
  await changes.click()
  await openTool("Inspector")
  const inspector = workbench.getByRole("tabpanel", { name: "Inspector" })
  await expect(inspector.getByText("2 files · 3 changes")).toBeVisible()
  await inspector.getByRole("button", { name: /shared\.txt/ }).filter({
    has: page.locator('[title="/isolated/shared.txt"]'),
  }).click()
  await expect(review.getByText("Subagent: Nested worker")).toBeVisible()
  await page.reload()
  await expect(review.getByText("Subagent: Nested worker")).toBeVisible()

  await page.getByRole("button", { name: "Other Root", exact: true }).click()
  await page.getByRole("button", { name: "Open side panel" }).click()
  await openTool("Review")
  await expect(review.getByText("other.txt", { exact: true })).toBeVisible()
  await expect(review.getByText("Subagent: Other worker")).toBeVisible()
  await expect(review.getByText(/shared\.txt/)).toHaveCount(0)
  expect(observation.pageErrors).toEqual([])
})
