import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

test("canonical Supervisor stays above ordinary session search and selects with the keyboard", async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
  await installArtifactRuntime(page, standaloneScenario)
  const ids = ["bamboo-default-supervisor", "all-surface-session"]
  const sessions = ids.map((id) => ({
    id, title: id === ids[0] ? "Supervisor" : "普通工作", title_version: 1,
    kind: "root", root_session_id: id, parent_session_id: null, spawn_depth: 0,
    pinned: true, model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
    created_at: "2026-10-05T00:00:00Z", updated_at: "2026-10-05T00:00:00Z",
    last_activity_at: "2026-10-05T00:00:00Z", message_count: 0, is_running: false,
    last_run_status: "completed", has_pending_question: false, subagent_count: 0,
  }))
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() === "GET" && path === "/api/v1/sessions") {
      await route.fulfill({ json: { sessions, total: 2, limit: 200, offset: 0 } })
    } else if (request.method() === "POST" && path === "/api/v1/supervisor/default") {
      await route.fulfill({ json: { session_id: ids[0], incarnation_id: "550e8400-e29b-41d4-a716-446655440000", created: false } })
    } else if (request.method() === "GET" && path === `/api/v1/sessions/${ids[0]}`) {
      await route.fulfill({ json: { session: sessions[0] }, headers: { ETag: '"1"' } })
    } else if (path === `/api/v1/history/${ids[0]}`) {
      await route.fulfill({ json: { session_id: ids[0], messages: [] } })
    } else if (path === `/api/v1/respond/${ids[0]}/pending`) {
      await route.fulfill({ json: { has_pending_question: false } })
    } else if (request.method() === "PATCH" && path === `/api/v1/sessions/${ids[0]}`) {
      await route.fulfill({ json: {} })
    } else await route.fallback()
  })
  await page.goto(standaloneScenario.entryUrl)
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible()
  const phone = testInfo.project.name === "phone-chromium"
  if (phone) await page.getByRole("button", { name: "菜单", exact: true }).click()
  const sidebar = page.locator("aside").first()
  const supervisor = sidebar.getByRole("button", { name: "Supervisor", exact: true })
  await expect(supervisor).toHaveCount(1)
  await expect(supervisor).toBeVisible()
  expect((await supervisor.boundingBox())!.y).toBeLessThan((await sidebar.getByRole("button", { name: "新建会话", exact: true }).boundingBox())!.y)
  await expect(sidebar.getByText("置顶", { exact: true })).toHaveCount(1)
  await sidebar.getByPlaceholder("搜索会话").fill("找不到")
  await expect(supervisor).toBeVisible()
  await expect(sidebar.getByRole("button", { name: "普通工作", exact: true })).toHaveCount(0)
  await supervisor.focus()
  await supervisor.press("Enter")
  await expect(supervisor).toHaveAttribute("aria-current", "page")
  await expect(supervisor).toBeEnabled()
  if (phone) {
    await page.getByRole("button", { name: "菜单", exact: true }).click()
    await expect(supervisor).toBeInViewport({ ratio: 1 })
  }
  await page.screenshot({ path: testInfo.outputPath("supervisor-top-entry.png") })
})

for (const initialState of ["absent", "empty", "history"] as const) {
  test(`Supervisor opens from ${initialState} state and reuses its identity after reload`, async ({ page }, testInfo) => {
    await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
    await installArtifactRuntime(page, standaloneScenario)
    const id = "bamboo-default-supervisor"
    const messages = initialState === "history" ? [{ id: "supervisor-history", role: "user", content: "保留的 Supervisor 历史", created_at: "2026-10-05T00:00:00Z" }] : []
    const summary = {
      id, title: "Supervisor", title_version: 1, kind: "root", root_session_id: id,
      parent_session_id: null, spawn_depth: 0, model: "fixture-model",
      model_ref: { provider: "fixture-provider", model: "fixture-model" },
      created_at: "2026-10-05T00:00:00Z", updated_at: "2026-10-05T00:00:00Z",
      last_activity_at: "2026-10-05T00:00:00Z", message_count: messages.length,
      is_running: false, has_pending_question: false, subagent_count: 0,
    }
    let exists = initialState !== "absent"
    let creations = 0
    let opens = 0
    let chatPosts = 0
    await page.route("**/api/v1/**", async (route) => {
      const request = route.request()
      const path = new URL(request.url()).pathname
      if (request.method() === "POST" && path === "/api/v1/supervisor/default") {
        const created = !exists
        exists = true; creations += Number(created); opens += 1
        await route.fulfill({ json: { session_id: id, incarnation_id: "550e8400-e29b-41d4-a716-446655440000", created } })
      } else if (path === "/api/v1/sessions" && request.method() === "GET") {
        const sessions = exists ? [summary] : []
        await route.fulfill({ json: { sessions, total: sessions.length, limit: 200, offset: 0 } })
      } else if (path === `/api/v1/sessions/${id}` && request.method() === "GET") {
        await route.fulfill({ json: { session: summary }, headers: { ETag: '"1"' } })
      } else if (path === `/api/v1/history/${id}`) {
        await route.fulfill({ json: { session_id: id, messages } })
      } else if (path === `/api/v1/respond/${id}/pending`) {
        await route.fulfill({ json: { has_pending_question: false } })
      } else if (path === `/api/v1/sessions/${id}` && request.method() === "PATCH") {
        await route.fulfill({ json: {} })
      } else {
        if (request.method() === "POST" && ["/api/v1/chat", "/api/v1/sessions"].includes(path)) chatPosts += 1
        await route.fallback()
      }
    })
    await page.goto(standaloneScenario.entryUrl)
    await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible()
    const phone = testInfo.project.name === "phone-chromium"
    const entry = page.locator("aside").first().getByRole("button", { name: "Supervisor", exact: true })
    await expect(entry).toBeEnabled()
    // The existing empty-account bootstrap creates its ordinary draft once.
    // Opening Supervisor must never use that ordinary creation path again.
    const initialChatPosts = chatPosts
    expect(initialChatPosts).toBe(initialState === "absent" ? 1 : 0)
    const open = async () => {
      if (phone) await page.getByRole("button", { name: "菜单", exact: true }).click()
      await expect(entry).toBeEnabled()
      await entry.click()
      await expect.poll(() => opens).toBeGreaterThan(0)
      await expect(entry).toHaveAttribute("aria-current", "page")
      await expect(entry).toBeEnabled()
    }
    await open()
    if (messages.length) await expect(page.getByText("保留的 Supervisor 历史", { exact: true })).toBeVisible()
    await open()
    await page.reload()
    await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible()
    await open()
    expect(creations).toBe(initialState === "absent" ? 1 : 0)
    expect(chatPosts).toBe(initialChatPosts)
    if (messages.length) await expect(page.getByText("保留的 Supervisor 历史", { exact: true })).toBeVisible()
    if (phone) {
      await page.getByRole("button", { name: "菜单", exact: true }).click()
      await expect(entry).toBeInViewport({ ratio: 1 })
    }
    await page.screenshot({ path: testInfo.outputPath(`supervisor-${initialState}.png`) })
  })
}

for (const navigation of ["return-to-session", "new-conversation"] as const) {
  test(`pending Supervisor opening respects newer palette navigation: ${navigation}`, async ({ page }, testInfo) => {
    await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
    await installArtifactRuntime(page, standaloneScenario)
    const supervisorId = "bamboo-default-supervisor"
    const sessions = ["navigation-a", "navigation-b", supervisorId].map((id) => ({
      id, title: id, title_version: 1, kind: "root", root_session_id: id,
      parent_session_id: null, spawn_depth: 0, model: "fixture-model",
      model_ref: { provider: "fixture-provider", model: "fixture-model" },
      created_at: "2026-10-05T00:00:00Z", updated_at: "2026-10-05T00:00:00Z",
      last_activity_at: "2026-10-05T00:00:00Z", message_count: id === supervisorId ? 0 : 1,
      is_running: false, has_pending_question: false, subagent_count: 0,
    }))
    let releaseOpen!: () => void
    const pendingOpen = new Promise<void>((resolve) => { releaseOpen = resolve })
    let opens = 0
    await page.route("**/api/v1/**", async (route) => {
      const request = route.request()
      const path = new URL(request.url()).pathname
      if (request.method() === "POST" && path === "/api/v1/supervisor/default") {
        opens += 1
        await pendingOpen
        await route.fulfill({ json: { session_id: supervisorId, incarnation_id: "550e8400-e29b-41d4-a716-446655440000", created: false } })
      } else if (request.method() === "GET" && path === "/api/v1/sessions") {
        await route.fulfill({ json: { sessions, total: sessions.length, limit: 200, offset: 0 } })
      } else {
        const session = sessions.find(({ id }) => path === `/api/v1/sessions/${id}`)
        const history = sessions.find(({ id }) => path === `/api/v1/history/${id}`)
        if (session && request.method() === "GET") {
          await route.fulfill({ json: { session }, headers: { ETag: '"1"' } })
        } else if (history) {
          const messages = history.id === supervisorId ? [] : [{ id: `${history.id}-message`, role: "user", content: `Transcript ${history.id}`, created_at: "2026-10-05T00:00:00Z" }]
          await route.fulfill({ json: { session_id: history.id, messages } })
        } else if (sessions.some(({ id }) => path === `/api/v1/respond/${id}/pending`)) {
          await route.fulfill({ json: { has_pending_question: false } })
        } else if (session && request.method() === "PATCH") {
          await route.fulfill({ json: {} })
        } else await route.fallback()
      }
    })
    const chooseInPalette = async (title: string) => {
      await page.keyboard.press("Control+k")
      const search = page.getByPlaceholder("搜索会话或操作…")
      await search.fill(title)
      await search.press("Enter")
      await expect(search).toBeHidden()
    }
    await page.goto(standaloneScenario.entryUrl)
    const entry = page.locator("aside").first().getByRole("button", { name: "Supervisor", exact: true })
    const transcriptA = page.getByText("Transcript navigation-a", { exact: true })
    await expect(entry).toBeEnabled()
    await chooseInPalette(navigation === "new-conversation" ? "新建对话" : "navigation-a")
    if (navigation === "return-to-session") await expect(transcriptA).toBeVisible()
    else await expect(transcriptA).toBeHidden()
    if (testInfo.project.name === "phone-chromium") await page.getByRole("button", { name: "菜单", exact: true }).click()
    await entry.click()
    await expect.poll(() => opens).toBe(1)
    if (navigation === "return-to-session") {
      await chooseInPalette("navigation-b")
      await expect(page.getByText("Transcript navigation-b", { exact: true })).toBeVisible()
      await chooseInPalette("navigation-a")
      await expect(transcriptA).toBeVisible()
    } else {
      await chooseInPalette("新建对话")
      await expect(transcriptA).toBeHidden()
    }
    releaseOpen()
    await expect(entry).toBeEnabled()
    await expect(entry).not.toHaveAttribute("aria-current", "page")
    if (navigation === "return-to-session") await expect(transcriptA).toBeVisible()
    else await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible()
  })
}
