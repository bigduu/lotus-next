import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "../support/artifactRuntime.js"

test("Project Work opens from both sidebar groupings and follows submission on the scoped board", async ({ page, baseURL, isMobile }, info) => {
  const entryUrl = new URL("/", baseURL).href
  await page.addInitScript(() => {
    localStorage.setItem("lotus.sidebar.grouping-mode.v1", "project")
    localStorage.setItem("bodhi_onboarded_v1", "1")
  })
  const observation = await installArtifactRuntime(page, {
    ...standaloneScenario, origin: new URL(entryUrl).origin, entryUrl,
  }, [], { serveStaticFromLocalServer: true })
  const project = {
    id: "solid-board", name: "Fixture project", status: "active", revision: 3, resource_revision: 1,
    schema_version: 3, project_path: "/fixture/project", project_path_status: "configured", workspace_count: 1,
    created_at: "2026-11-07T00:00:00Z", updated_at: "2026-11-07T00:00:00Z", workspace_bindings: [],
    sidebar: { sections: [], session_sections: {}, hidden_legacy: false },
  }
  const snapshot = { commit: "fixture-board-cursor", seq: 10, authority_epoch: 1 }
  const envelope = { snapshot, index_seq: 10, coverage: "authoritative_scope", truncated: false, omitted_count: 0, next_cursor: null }
  const rows = [
    { id: "fixture-testing", state: "submitted", title: "Verify this work", stage: "testing" },
    { id: "fixture-cancelled", state: "cancelled", title: "Stopped experiment", stage: null },
  ].map(({ id, state, title, stage }) => ({
    ticket: {
      id, scope_id: "fixture-work-scope", kind: "work", state, generation: 1, record_revision: 1, contract_revision: 1,
      updated_seq: 9, archived: false, contract: { title, objective: "Board scope fixture", constraints: [], acceptance: [] },
      active_assignment: null, current_submission: null, accepted_submission: null, depends_on: [],
    },
    stage, context: null, adopted_context: null,
  }))
  let phase: "initial" | "executing" | "submitted" = "initial"
  const submittedSnapshot = { ...snapshot, commit: "fixture-submitted-cursor", seq: 11 }
  const currentEnvelope = () => phase === "submitted"
    ? { ...envelope, snapshot: submittedSnapshot, index_seq: submittedSnapshot.seq } : envelope
  const boardQueries: unknown[] = []
  await page.route("**/api/v1/projects", (route) => route.fulfill({ json: { projects: [project] } }))
  await page.route(`**/api/v1/projects/${project.id}`, (route) => route.fulfill({ json: project }))
  await page.route(`**/api/v1/projects/${project.id}/scan`, (route) => route.fulfill({ status: 404, json: { error: "Legacy fixture" } }))
  await page.route("**/api/v1/tickets/sprints/list", (route) => route.fulfill({ status: 404, json: { error: "Legacy fixture" } }))
  await page.route("**/api/v1/tickets/project-board", (route) => {
    const body = route.request().postDataJSON()
    boardQueries.push(body)
    const doing = phase === "executing"
    const item = {
      ...rows[0], stage: doing ? "doing" : "testing",
      ticket: { ...rows[0].ticket, state: doing ? "active" : "submitted",
        current_submission: phase === "submitted" ? "verified-submission" : null },
    }
    return route.fulfill({ json: { ...currentEnvelope(), data: {
      project_id: project.id, counts: { todo: 0, doing: doing ? 1 : 0, testing: doing ? 0 : 1, done: 0, blocked: 0, cancelled: 1, total: 2 },
      rows: body.include_cancelled ? [item, rows[1]] : [item],
    } } })
  })
  await page.route("**/api/v1/tickets/changes", (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ since_seq: snapshot.seq })
    return route.fulfill({ json: {
      ...currentEnvelope(), data: phase === "submitted" ? [{ seq: submittedSnapshot.seq, entity: "work", id: rows[0].ticket.id }] : [],
    } })
  })
  await page.route("**/api/v1/tickets/inspect", (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ ids: ["fixture-testing"], fixed_commit: snapshot.commit })
    return route.fulfill({ json: { ...envelope, data: [{ ticket: rows[0].ticket, requests: [], submissions: [], assignments: [] }] } })
  })

  await page.goto(entryUrl)
  if (isMobile) await page.getByRole("button", { name: "菜单", exact: true }).click()
  const projectRow = page.locator(`[data-sidebar-project="${project.id}"]`)
  const disclosure = projectRow.locator("button[aria-controls]").first()
  const shortcut = projectRow.getByRole("button", { name: "Fixture project 看板", exact: true })
  await expect(shortcut).toBeVisible()
  await disclosure.click()
  await expect(disclosure).toHaveAttribute("aria-expanded", "false")
  await expect(shortcut).toHaveText("看板")
  await expect(shortcut).toBeVisible()
  await info.attach("project-board-sidebar-entry", { body: await page.screenshot(), contentType: "image/png" })
  expect(boardQueries).toEqual([])
  await shortcut.click()
  const board = page.getByRole("dialog", { name: "项目工作 · Fixture project" })
  await expect(board.getByRole("button", { name: "看板", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(board.getByText("当前后端不支持 Sprint 规划，仍可查看全部工作。", { exact: true })).toBeVisible()
  await expect(board.getByText("无法读取 Sprint 规划", { exact: false })).toHaveCount(0)
  const card = board.getByRole("region", { name: "待验收", exact: true }).getByRole("button", { name: /Verify this work/ })
  await expect(card).toBeVisible()
  await expect(board.getByRole("region", { name: "后台扫描", exact: true })).toHaveCount(0)
  await card.click()
  await expect(board.getByText("Board scope fixture", { exact: true }).first()).toBeVisible()
  await board.getByRole("checkbox", { name: "显示已取消" }).check()
  await expect(board.getByText("Stopped experiment", { exact: true })).toBeVisible()
  expect(boardQueries).toEqual([false, true].map((include_cancelled) => expect.objectContaining({
    project_id: project.id, include_cancelled, include_archived: false,
  })))
  await page.keyboard.press("Escape")
  await expect(board).toBeHidden()
  await expect(shortcut).toBeFocused()
  await page.getByRole("button", { name: "切换为最近视图" }).click()
  const chooser = page.getByRole("button", { name: "项目看板", exact: true })
  await expect(chooser).toBeVisible()
  expect(boardQueries).toHaveLength(2)
  await chooser.click()
  phase = "executing"
  await page.getByRole("menuitem", { name: project.name, exact: true }).click()
  await expect(board.getByRole("region", { name: "进行中", exact: true }).getByRole("button", { name: /Verify this work/ })).toBeVisible()
  phase = "submitted"
  await expect(card).toContainText("存在提交", { timeout: 12_000 })
  expect(boardQueries.at(-1)).toMatchObject({ project_id: project.id, include_cancelled: false })
  await info.attach("project-board-completed-work", { body: await page.screenshot({ animations: "disabled" }), contentType: "image/png" })
  await page.keyboard.press("Escape")
  await expect(board).toBeHidden()
  await expect(chooser).toBeFocused()
  expect(observation.pageErrors).toEqual([])
})

test("Project scan controls live in System Settings and the board shows scoped activity", async ({ page, baseURL, isMobile }, info) => {
  const entryUrl = new URL("/", baseURL).href
  await page.addInitScript(() => {
    localStorage.setItem("lotus.sidebar.grouping-mode.v1", "project")
    localStorage.setItem("bodhi_onboarded_v1", "1")
  })
  const observation = await installArtifactRuntime(page, {
    ...standaloneScenario, origin: new URL(entryUrl).origin, entryUrl,
  }, [], { serveStaticFromLocalServer: true })
  const project = {
    id: "scan-project", name: "Documentation project", status: "active", revision: 3, resource_revision: 1,
    schema_version: 3, project_path: "/fixture/docs", project_path_status: "configured", workspace_count: 1,
    created_at: "2026-11-07T00:00:00Z", updated_at: "2026-11-07T00:00:00Z", workspace_bindings: [],
    sidebar: { sections: [], session_sections: {}, hidden_legacy: false },
  }
  const other = { ...project, id: "other-project", name: "Other project", project_path: "/fixture/other" }
  const snapshot = { commit: "fixture-scan-cursor", seq: 10, authority_epoch: 1 }
  const envelope = { snapshot, index_seq: 10, coverage: "authoritative_scope", truncated: false, omitted_count: 0, next_cursor: null }
  const work = { id: "fixture-ready", title: "Check installation notes" }
  const requiredFile = `docs/${"worktree-input-".repeat(12)}.md`
  const modes = { enable: "enabled", pause: "paused", resume: "enabled", disable: "off" } as const
  const scanStates = new Map([project, other].map(({ id }) => [id, { mode: "off", requests: 0 }]))
  const scanCommands: { projectId: string; action: string }[] = []
  await page.route("**/api/v1/bamboo/config", (route) => route.fulfill({ json: {
    proxy_auth_mode: "auto", features: { ticket_mutation: true, ticket_dispatch: true },
  } }))
  await page.route("**/api/v1/projects", (route) => route.fulfill({ json: { projects: [project, other] } }))
  await page.route(`**/api/v1/projects/${project.id}`, (route) => route.fulfill({ json: project }))
  await page.route("**/api/v1/projects/*/scan", (route) => {
    const projectId = new URL(route.request().url()).pathname.split("/").at(-2)!
    const state = scanStates.get(projectId)!
    if (route.request().method() === "POST") {
      const { action } = route.request().postDataJSON() as { action: keyof typeof modes }
      scanCommands.push({ projectId, action })
      state.mode = modes[action]
      if (action === "enable") state.requests++
    }
    return route.fulfill({ json: {
      project_id: projectId, mode: state.mode, model: "fixture-fast", available: true,
      in_flight: false, last_result: state.mode === "enabled" ? "waiting" : "idle",
      last_check: state.mode === "enabled" ? {
        work_id: work.id, title: work.title, summary: null,
        blocker: { kind: "required_file_unavailable", path: requiredFile },
      } : null,
      usage: { model_requests: state.requests, unknown_requests: 0,
        tokens: { prompt_tokens: 101 * state.requests, completion_tokens: 23 * state.requests, total_tokens: 124 * state.requests } },
    } })
  })
  await page.route("**/api/v1/tickets/sprints/list", (route) => route.fulfill({ status: 404, json: { error: "Legacy fixture" } }))
  await page.route("**/api/v1/tickets/project-board", (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ project_id: project.id })
    return route.fulfill({ json: { ...envelope, data: {
      project_id: project.id, counts: { todo: 1, doing: 0, testing: 0, done: 0, blocked: 0, cancelled: 0, total: 1 },
      rows: [{
        ticket: {
          id: work.id, scope_id: "fixture-work-scope", kind: "work", state: "ready", generation: 0,
          record_revision: 1, contract_revision: 1, updated_seq: 9, archived: false,
          contract: { title: work.title, objective: "Check the documented installer prerequisites.", constraints: [], acceptance: [] },
          active_assignment: null, current_submission: null, accepted_submission: null, depends_on: [],
        },
        stage: "todo", context: null, adopted_context: null,
      }],
    } } })
  })
  await page.route("**/api/v1/tickets/changes", (route) => route.fulfill({ json: { ...envelope, data: [] } }))

  await page.goto(entryUrl)
  const menu = page.getByRole("button", { name: "菜单", exact: true })
  const settingsEntry = page.getByRole("button", { name: "系统设置", exact: true })
  const settings = page.locator('[data-slot="settings-page"]')
  const controls = settings.getByRole("region", { name: "后台扫描", exact: true })
  const openScanSettings = async () => {
    if (isMobile && !(await settingsEntry.isVisible())) await menu.click()
    await settingsEntry.click()
    if (isMobile) await settings.getByRole("combobox", { name: "系统设置" }).selectOption("system")
    else await settings.getByRole("button", { name: "系统", exact: true }).click()
    await expect(controls).toBeVisible()
  }
  const chooseProject = async (name: string) => {
    const select = controls.getByRole("combobox", { name: "项目", exact: true })
    await select.click()
    await page.getByRole("option", { name, exact: true }).click()
    await expect(select).toHaveText(name)
  }
  const board = page.getByRole("dialog", { name: `项目工作 · ${project.name}` })
  const scan = board.getByRole("region", { name: "后台扫描", exact: true })
  const openBoardFromSettings = async () => {
    await settings.getByRole("button", { name: "返回聊天", exact: true }).click()
    if (isMobile) await menu.click()
    await page.getByRole("button", { name: `${project.name} 看板`, exact: true }).click()
    await expect(scan).toBeVisible()
  }

  await openScanSettings()
  await chooseProject(project.name)
  await controls.getByRole("button", { name: "开启扫描" }).click()
  await expect(controls.getByRole("status")).toHaveText("已开启")
  await controls.getByRole("button", { name: "暂停扫描" }).click()
  await expect(controls.getByRole("status")).toHaveText("已暂停")
  await chooseProject(other.name)
  await expect(controls.getByRole("status")).toHaveText("已关闭")
  await chooseProject(project.name)
  await expect(controls.getByRole("status")).toHaveText("已暂停")
  await info.attach("system-project-scan-settings", { body: await page.screenshot(), contentType: "image/png" })

  await openBoardFromSettings()
  await expect(scan.getByRole("status")).toHaveText("已暂停")
  await expect(scan.getByText(/1 次请求 · 输入 101 \/ 输出 23 token/)).toBeVisible()
  await expect(scan.getByRole("button")).toHaveCount(0)
  await page.keyboard.press("Escape")
  await expect(board).toBeHidden()

  await openScanSettings()
  await chooseProject(project.name)
  await controls.getByRole("button", { name: "恢复扫描" }).click()
  await expect(controls.getByRole("status")).toHaveText("已开启")
  await openBoardFromSettings()
  await expect(scan.getByRole("status")).toHaveText("已开启")
  await expect(scan.getByText(`所需文件 ${requiredFile} 不可用`)).toBeVisible()
  await expect(scan.getByTitle(work.id)).toHaveText(work.title)
  await expect(board.getByRole("button", { name: new RegExp(work.title) })).toBeVisible()
  await expect(scan.getByText("等待就绪卡片")).toHaveCount(0)
  scanStates.get(project.id)!.requests = 2
  await board.getByRole("button", { name: "刷新", exact: true }).click()
  await expect(scan.getByText(/2 次请求 · 输入 202 \/ 输出 46 token/)).toBeVisible()
  expect(await scan.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  await info.attach("project-board-scan-blocker", { body: await page.screenshot({ animations: "disabled" }), contentType: "image/png" })
  await page.keyboard.press("Escape")
  await expect(board).toBeHidden()

  await openScanSettings()
  await chooseProject(project.name)
  await controls.getByRole("button", { name: "关闭扫描" }).click()
  await expect(controls.getByRole("status")).toHaveText("已关闭")
  await expect(controls.getByRole("button", { name: "开启扫描" })).toBeFocused()
  expect(scanCommands).toEqual(["enable", "pause", "resume", "disable"].map((action) => ({ projectId: project.id, action })))
  expect(observation.pageErrors).toEqual([])
})
