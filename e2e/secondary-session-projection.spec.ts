import { expect, test, type Page } from "@playwright/test"
import { actorSnapshotFixture } from "../src/test/fixtures/actorSnapshot.js"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const rootId = "all-surface-session"
const otherRootId = "other-subagent-root"
const childId = "branch-child"
const nestedId = "nested-child"
const foreignChildId = "foreign-child"
const at = "2026-09-22T00:00:00.000Z"
const activeSnapshot = actorSnapshotFixture(rootId, 2)
Object.assign(activeSnapshot.nodes[0], { title: "Current root" })
Object.assign(activeSnapshot.nodes[1], { actor_id: childId, title: "Search branch" })
Object.assign(activeSnapshot.nodes[2], { actor_id: nestedId, parent_actor_id: childId, depth: 2, title: "Nested writer" })
const otherSnapshot = actorSnapshotFixture(otherRootId, 1)
Object.assign(otherSnapshot.nodes[0], { title: "Other root" })
Object.assign(otherSnapshot.nodes[1], { actor_id: foreignChildId, title: "Foreign child" })
const snapshots = [activeSnapshot, otherSnapshot]
const sessions = snapshots.flatMap(({ nodes }) => nodes.map((node) => ({
  id: node.actor_id, title: node.title, title_version: 1, kind: node.role, pinned: false,
  parent_session_id: node.parent_actor_id, root_session_id: node.root_actor_id, spawn_depth: node.depth,
  model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
  created_at: at, updated_at: at, last_activity_at: at, message_count: 1,
  subagent_count: node.role === "root" ? nodes.length - 1 : 0,
  is_running: false, last_run_status: "completed", permission_mode: "default", bypass_permissions: false,
})))

async function prepare(page: Page, legacyTarget?: string) {
  await page.addInitScript(({ rootId, legacyTarget, origin }) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", rootId)
    if (legacyTarget) {
      const key = "lotus-next.workbench.v1:" + encodeURIComponent(origin + "/api/v1") + ":" + encodeURIComponent(rootId)
      localStorage.setItem(key, JSON.stringify({ version: 1, state: {
        open: true, tab: "session", tools: ["session"], order: ["tool:session"], secondSid: legacyTarget,
      } }))
    }
  }, { rootId, legacyTarget, origin: standaloneScenario.origin })
  const observation = await installArtifactRuntime(page, standaloneScenario)
  const projected: string[] = []
  const holdNested = Promise.withResolvers<void>()
  if (legacyTarget) holdNested.resolve()
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    if (request.method() !== "GET") return route.fallback()
    if (path === "/api/v1/sessions") {
      const kind = url.searchParams.get("kind")
      const root = url.searchParams.get("root_session_id")
      const selected = sessions.filter((item) => (!kind || item.kind === kind) && (!root || item.root_session_id === root))
      return route.fulfill({ json: { sessions: selected, total: selected.length, limit: 200, offset: 0 } })
    }
    const snapshot = snapshots.find((item) => path === "/api/v1/actors/" + item.root_actor_id + "/snapshot")
    if (snapshot) return route.fulfill({ json: snapshot })
    const chosen = sessions.find((item) => path === "/api/v1/sessions/" + item.id)
    if (chosen) return route.fulfill({ json: { session: chosen }, headers: { ETag: '"1"' } })
    const history = sessions.find((item) => path === "/api/v1/sessions/" + item.id + "/history")
    if (history) {
      expect(url.searchParams.get("projection")).toBe("messages")
      projected.push(history.id)
      if (history.id === nestedId) await holdNested.promise
      return route.fulfill({ json: {
        session_id: history.id, projection: "messages", is_delta: false, truncated: false, total_message_count: 1,
        messages: [{ id: history.id + "-answer", role: "assistant", content: history.title + " answer", created_at: at }],
      } })
    }
    return route.fallback()
  })
  await page.goto(standaloneScenario.entryUrl)
  return { observation, projected, holdNested }
}

const frame = (value: unknown) => value as { type?: string; ch?: string }

test("reads and quickly switches only between subagents in the active tree", async ({ page }, info) => {
  const { observation, projected, holdNested } = await prepare(page)
  try {
    await page.getByRole("button", { name: "查看子代理树", exact: true }).click()
    const panel = page.locator("#right-workbench")
    const tree = panel.getByRole("tree")
    await expect(tree).toBeVisible()
    await expect(tree.getByRole("treeitem", { name: /Search branch/ })).toBeVisible()
    expect(projected).toEqual([])
    await expect(tree.getByRole("treeitem", { name: /Other root|Foreign child/ })).toHaveCount(0)
    await tree.getByRole("treeitem", { name: /Search branch/ }).click()
    await expect(panel.getByText("Search branch answer")).toBeVisible()
    await expect(panel.getByRole("textbox", { name: "消息", exact: true })).toHaveCount(0)

    const switcher = panel.getByRole("button", { name: "切换子代理", exact: true })
    await switcher.click()
    await expect(page.getByRole("option", { name: /Other root|Foreign child/ })).toHaveCount(0)
    const search = page.getByRole("combobox", { name: "搜索子代理", exact: true })
    await search.fill("Nested")
    const nested = page.getByRole("option", { name: /Nested writer.*Current root \/ Search branch/ })
    await expect(nested).toBeVisible()
    await info.attach("filtered-subagent-picker", { body: await page.screenshot({ animations: "disabled" }), contentType: "image/png" })
    await search.press("Enter")
    await expect.poll(() => projected.includes(nestedId)).toBe(true)
    await expect(panel.getByText("Search branch answer")).toHaveCount(0)
    await switcher.click()
    await page.getByRole("option", { name: /Search branch.*Current root/ }).click()
    await expect(panel.getByText("Search branch answer")).toBeVisible()
    const late = page.waitForResponse((response) => response.url().includes("/sessions/" + nestedId + "/history"))
    holdNested.resolve()
    await late
    await expect(panel.getByText("Nested writer answer")).toHaveCount(0)

    await switcher.click()
    await page.getByRole("option", { name: /Nested writer/ }).click()
    await expect(panel.getByText("Nested writer answer")).toBeVisible()
    await panel.getByRole("button", { name: "返回树", exact: true }).click()
    await expect(tree.getByRole("treeitem", { name: /Nested writer/ })).toHaveAttribute("aria-selected", "true")
    await expect(tree.getByRole("treeitem", { name: /Nested writer/ })).toHaveAttribute("aria-level", "3")
    for (const id of [childId, nestedId]) {
      await expect.poll(() => observation.clientFrames.some((value) => frame(value).type === "subscribe" && frame(value).ch === "message." + id)).toBe(true)
      await expect.poll(() => observation.clientFrames.some((value) => frame(value).type === "unsubscribe" && frame(value).ch === "message." + id)).toBe(true)
    }
    expect(projected.every((id) => id === childId || id === nestedId)).toBe(true)
    expect(observation.clientFrames.some((value) => [childId, nestedId].some((id) => frame(value).ch === "agent." + id))).toBe(false)
    expect(observation.httpRequests.some(({ url }) => [childId, nestedId, otherRootId].some((id) => new URL(url).pathname === "/api/v1/history/" + id))).toBe(false)
    expect(observation.pageErrors).toEqual([])
    expect(observation.protocolErrors).toEqual([])
  } finally {
    holdNested.resolve()
  }
})

for (const [target, label] of [[nestedId, "a child in the tree"], [otherRootId, "another root"], [foreignChildId, "a child from another tree"]]) {
  test("migrates a legacy side selection for " + label, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop-chromium", "Storage upgrade coverage")
    const { projected } = await prepare(page, target)
    const panel = page.locator("#right-workbench")
    await expect(panel.getByRole("tab", { name: "子代理", exact: true })).toHaveAttribute("aria-selected", "true")
    if (target === nestedId) {
      await expect(panel.getByText("Nested writer answer")).toBeVisible()
      expect(projected).toEqual([nestedId])
    } else {
      await expect(panel.getByRole("tree").getByRole("treeitem", { name: /Current root/ })).toBeVisible()
      await expect(panel.locator("[data-subagent-transcript-pane]")).toHaveCount(0)
      expect(projected).toEqual([])
    }
  })
}
