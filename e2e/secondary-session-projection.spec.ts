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
  root_orchestration_only: false, thinking_mode: "standard", reasoning_effort: "medium",
  root_mode_transition_epoch: 0, root_mode_birth_token: "a".repeat(64),
})))

async function prepare(page: Page, legacyTarget?: string, content: "short" | "history" | "wide" = "short") {
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
  let releaseNested!: () => void
  const holdNested = new Promise<void>((resolve) => { releaseNested = resolve })
  if (legacyTarget || content !== "short") releaseNested()
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
      if (history.id === nestedId) await holdNested
      const messages = content === "history" ? Array.from({ length: 64 }, (_, index) => ({
        id: history.id + "-" + index, role: index % 2 === 0 ? "user" : "assistant",
        content: history.title + " message " + index + ". " + "Reading context. ".repeat(12), created_at: at,
      })) : [{ id: history.id + "-answer", role: "assistant", content: content === "wide" ? [
          "Reading a narrow transcript. " + "long_identifier_".repeat(30),
          "", "| First column | Second column | Third column | Fourth column |",
          "| --- | --- | --- | --- |",
          "| " + Array.from({ length: 4 }, () => "Wide content ".repeat(5).trim()).join(" | ") + " |",
          "", String.fromCharCode(96).repeat(3) + "text",
          "long_source_line_".repeat(40), String.fromCharCode(96).repeat(3),
        ].join("\n") : history.title + " answer", created_at: at }]
      return route.fulfill({ json: {
        session_id: history.id, projection: "messages", is_delta: false, truncated: false,
        total_message_count: messages.length, messages,
      } })
    }
    return route.fallback()
  })
  await page.goto(standaloneScenario.entryUrl)
  return { observation, projected, releaseNested }
}

const frame = (value: unknown) => value as { type?: string; ch?: string }

test("reads and quickly switches only between subagents in the active tree", async ({ page }, info) => {
  const { observation, projected, releaseNested } = await prepare(page)
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
    releaseNested()
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
    releaseNested()
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

test("restores the subagent view, expansion and reading anchor with its own session", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-chromium", "Desktop sidebar navigation and independent workbench views")
  await prepare(page, undefined, "history")
  const panel = page.locator("#right-workbench")
  const transcript = panel.locator("[data-subagent-transcript-pane] .overflow-y-auto")
  const openTree = () => page.getByRole("button", { name: "查看子代理树", exact: true }).click()
  const branch = panel.getByRole("treeitem", { name: /Search branch/ })
  const nested = panel.getByRole("treeitem", { name: /Nested writer/ })
  const switcher = panel.getByRole("button", { name: "切换子代理", exact: true })

  await openTree()
  await branch.locator("[data-actor-toggle]").click()
  await nested.click()
  await expect(transcript.getByText(/Nested writer message 63/)).toBeVisible()
  await transcript.hover()
  await page.mouse.wheel(0, -1200)
  await expect(panel.getByRole("button", { name: "滚动到底部", exact: true })).toBeVisible()
  const anchor = await transcript.evaluate((element) => {
    const top = element.getBoundingClientRect().top
    return [...element.querySelectorAll("[data-history-entry-key]")]
      .find((row) => row.getBoundingClientRect().bottom > top + 4)?.getAttribute("data-history-entry-key") ?? null
  })
  expect(anchor).toBeTruthy()

  await page.getByRole("button", { name: "Other root", exact: true }).click()
  await expect(panel).toBeHidden()
  await openTree()
  await expect(panel.getByRole("treeitem", { name: /Foreign child/ })).toBeVisible()
  await page.getByRole("button", { name: "Current root", exact: true }).click()
  await expect(switcher).toContainText("Nested writer")
  await expect(transcript.locator("[data-history-entry-key=" + JSON.stringify(anchor) + "]")).toBeInViewport()
  await panel.getByRole("button", { name: "收起工作面板", exact: true }).click()
  await expect(panel).toBeHidden()
  await page.getByRole("button", { name: "打开侧边面板", exact: true }).click()
  await expect(switcher).toContainText("Nested writer")
  await expect(transcript.locator("[data-history-entry-key=" + JSON.stringify(anchor) + "]")).toBeInViewport()
  await panel.getByRole("button", { name: "返回树", exact: true }).click()
  await expect(branch).toHaveAttribute("aria-expanded", "true")
  await expect(nested).toHaveAttribute("aria-selected", "true")

  await page.reload({ waitUntil: "domcontentloaded" })
  await expect(branch).toHaveAttribute("aria-expanded", "true")
  await expect(nested).toHaveAttribute("aria-selected", "true")
  await panel.getByRole("button", { name: "关闭子代理标签页", exact: true }).click()
  await expect(panel.getByText("还没有打开内容")).toBeVisible()
  await expect(panel.getByRole("tab", { name: "子代理", exact: true })).toHaveCount(0)
  await info.attach("restored-session-tree", { body: await page.screenshot({ animations: "disabled" }), contentType: "image/png" })
})

test("narrow tree and transcript fit the workbench while wide blocks scroll locally", async ({ page }, info) => {
  const desktop = info.project.name === "desktop-chromium"
  if (desktop) await page.setViewportSize({ width: 1080, height: 900 })
  const { observation } = await prepare(page, undefined, "wide")
  await page.getByRole("button", { name: "查看子代理树", exact: true }).click()
  const panel = page.locator("#right-workbench")
  if (desktop) await expect(panel).not.toHaveAttribute("aria-modal")
  else await expect(panel).toHaveAttribute("aria-modal", "true")
  if (info.project.name === "phone-chromium") {
    await expect.poll(async () => (await panel.boundingBox())!.width).toBeCloseTo(page.viewportSize()!.width, 0)
  }
  const tree = panel.getByRole("tree")
  await tree.getByRole("treeitem", { name: /Search branch/ }).locator("[data-actor-toggle]").click()
  await tree.getByRole("treeitem", { name: /Nested writer/ }).click()
  const transcript = panel.locator("[data-subagent-transcript-pane]")
  await expect(transcript.getByText(/Reading a narrow transcript/)).toBeVisible()
  const code = transcript.locator('[data-streamdown="code-block-body"]')
  const table = transcript.locator('[data-streamdown="table-wrapper"] > div').last()
  for (const [name, block] of [["code", code], ["table", table]] as const) {
    await expect(block).toBeVisible()
    await expect(block).toHaveCSS("overflow-x", "auto")
    await expect.poll(() => block.evaluate((element) => element.scrollWidth - element.clientWidth), { message: name + " scrolls within its block" }).toBeGreaterThan(10)
  }
  await expect.poll(() => transcript.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  const before = await transcript.boundingBox()
  expect(before).not.toBeNull()
  expect(before!.x + before!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1)
  if (desktop) {
    const switcher = panel.getByRole("button", { name: "切换子代理", exact: true })
    await switcher.focus()
    await page.setViewportSize({ width: 1000, height: 900 })
    await expect(panel).toHaveAttribute("aria-modal", "true")
    await expect(switcher).toBeFocused()
    await expect(transcript.getByText(/Reading a narrow transcript/)).toBeVisible()
    await page.setViewportSize({ width: 1080, height: 900 })
    await expect(panel).not.toHaveAttribute("aria-modal")
    await expect(switcher).toBeFocused()
  }
  expect(observation.pageErrors).toEqual([])
  await info.attach("narrow-subagent-transcript", { body: await page.screenshot({ animations: "disabled" }), contentType: "image/png" })
})
