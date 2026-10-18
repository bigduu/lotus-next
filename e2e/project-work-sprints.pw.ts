import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { expect, test, type Page, type TestInfo } from "@playwright/test"

// Every response below is a controlled mock variation of this exact capture.
// It deliberately does not claim another actual backend/TCP/runtime run.
const payload = JSON.parse(readFileSync("src/test/fixtures/sprintContract/producer-http-payload.json", "utf8"))
const producer = payload.requests_and_actual_responses
const projectId = producer.list_request.project_id
const workId = Object.keys(producer.close_response.closure.members)[0]
const blockedId = "mock-blocked-work"
const acceptedId = "mock-accepted-work"
const cancelledId = "mock-cancelled-work"
const backlogId = "mock-backlog-work"
const historicalId = "mock-closed-history-work"
const binding = producer.close_request.binding
const output = process.env.LOTUS_SPRINT_REVIEW_DIR ?? path.join(tmpdir(), "lotus-sprint-browser-review")
const clone = <T,>(value: T): T => structuredClone(value)
const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex")
const canonicalValue = (value: any): any => Array.isArray(value) ? value.map(canonicalValue)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonicalValue(item)])) : value
const sourceFiles = [
  "src/components/app/ProjectWorkBoard.tsx", "src/components/app/project-work/ProjectSprintPanel.tsx",
  "src/components/app/project-work/SprintOwnerControls.tsx", "src/hooks/useProjectSprints.ts",
  "src/hooks/useProjectWorkBoard.ts", "src/services/tickets/sprints.ts", "src/services/tickets/projectBoard.ts",
  "src/shared/i18n/resources/ui-zh-CN.ts", "e2e/fixtures/project-sprints.tsx", "e2e/project-work-sprints.pw.ts",
]
const sourceProof = () => ({
  head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  status: execFileSync("git", ["status", "--short"], { encoding: "utf8" }),
  frozen: false,
  files: Object.fromEntries(sourceFiles.map((name) => [name, sha256(readFileSync(name))])),
})
const initialSource = sourceProof()
const snapshot = (seq: number) => ({ commit: `mock-sprint-snapshot-${seq}`, seq, authority_epoch: 1 })
const definition = (name: string) => ({ name, goal: "保留同一 Work、Assignment 与权限事实；关闭只改变规划关系，不会把未完成工作当作完成。", starts_at: null, ends_at: null })
const counts = (total: number, accepted = 0, unfinished = total - accepted, blocked = 0, cancelled = 0) => ({ total, accepted, pending_acceptance: 0, blocked, cancelled, unfinished })
const envelope = (seq: number, data: unknown) => ({ snapshot: snapshot(seq), index_seq: seq, coverage: "authoritative_scope", truncated: false, omitted_count: 0, next_cursor: null, data })

interface ApiRecord { method: string; path: string; body: any; rawBody: string | null; status?: number }
interface MockOptions { pagination?: boolean; unavailable?: boolean; denyFilter?: boolean; conflictOnce?: boolean; unknownThenDenied?: boolean; keyboardNames?: boolean }
function createModel(options: MockOptions = {}) {
  let seq = 7
  let commandAttempts = 0
  let savedReceipt: any = null
  const baseVersion = clone(producer.inspect_response.data.current_members[workId])
  const versions: Record<string, any> = {
    [workId]: { ...baseVersion, state: "active", generation: 1, active_assignment: "mock-original-assignment" },
    [blockedId]: { ...baseVersion, state: "blocked", generation: 1, paused: true, blocked_resume_state: "ready" },
    [acceptedId]: { ...baseVersion, state: "accepted", accepted: true, current_submission: "mock-accepted-submission", accepted_submission: "mock-accepted-submission" },
    [cancelledId]: { ...baseVersion, state: "cancelled" },
    [backlogId]: { ...baseVersion },
    [historicalId]: { ...baseVersion, state: "accepted", accepted: true, current_submission: "mock-history-submission", accepted_submission: "mock-history-submission" },
  }
  const closing = clone(producer.close_response.closure) as any
  closing.members = { [historicalId]: clone(closing.members[workId]) }
  closing.source_commit = snapshot(6).commit
  const sprints: Record<string, any> = {
    a: { ...clone(producer.inspect_response.data.sprint), id: "a", definition: definition("当前 Sprint · 显式规划"), status: "active", revision: 3, updated_seq: 6,
      members: [workId, blockedId, acceptedId, cancelledId], history: [], closure: null },
    b: { ...clone(producer.inspect_response.data.sprint), id: "b", definition: definition("下一 Sprint · 保留原执行身份"), status: "planned", revision: 2, updated_seq: 6,
      members: [], history: [], closure: null },
    c: { ...clone(producer.inspect_response.data.sprint), id: "c", definition: definition("已关闭 Sprint · 当前验收与冻结关闭记录不同"), revision: 4,
      members: [historicalId], closure: closing,
      history: producer.inspect_response.data.sprint.history.map((event: any) => ({ ...clone(event), work_id: historicalId, source: "Controlled fixture provenance · 显式转入待规划工作，历史记录保持不变。" })) },
  }
  if (options.keyboardNames) sprints.a.definition.name = "Sprint A · controlled native-keyboard fixture"
  function summary(sprint: any) {
    const { members, history: _history, closure, ...row } = sprint
    return { ...row, member_count: members.length, closure_counts: closure?.counts ?? null }
  }
  function ticket(id: string) {
    const version = versions[id]
    const { accepted: _accepted, context_hash: _context, blocked_resume_state: _resume, ...record } = clone(version)
    const titles: Record<string, string> = {
      [workId]: "执行中的原 Work · Sprint 关闭不会停止或复制执行",
      [blockedId]: "等待明确条件的 Work · 暂停状态与未完成事实保持可见",
      [acceptedId]: "已有精确验收证据的 Work",
      [cancelledId]: "已取消 Work · 计数保留而默认隐藏行",
      [backlogId]: "待规划 Work · 仍未分配到开放 Sprint",
      [historicalId]: "历史成员当前已验收 · 不改写关闭时未完成记录",
    }
    return { id, scope_id: binding.scope_id, depends_on: [], parent: null, kind: "work", ...record, updated_seq: seq, import_source: null,
      contract: { title: titles[id], objective: "合成看板记录，仅核对真实父组件的读取与交互，不调用模型或执行 worker。", constraints: ["同一 Work 与原 Assignment 引用"], acceptance: ["规划回执不等于 User 验收"] },
      blocked: version.state === "blocked" ? { reason: "合成外部条件尚未满足", resume_state: "ready" } : null }
  }
  function board(body: any) {
    const filter = body.sprint_filter
    const openIds = new Set(Object.values(sprints).filter((item: any) => item.status !== "closed").flatMap((item: any) => item.members))
    const ids: string[] = filter?.kind === "sprint" ? sprints[filter.sprint_id]?.members ?? []
      : filter?.kind === "backlog" ? Object.keys(versions).filter((id) => !openIds.has(id)) : Object.keys(versions)
    const dataCounts = { todo: 0, doing: 0, testing: 0, done: 0, blocked: 0, cancelled: 0, total: ids.length }
    const rows = ids.flatMap((id) => {
      const value = ticket(id)
      const stage = value.state === "cancelled" ? null : value.state === "accepted" ? "done" : value.state === "active" ? "doing" : "todo"
      if (stage) dataCounts[stage]++
      if (value.state === "blocked") dataCounts.blocked++
      if (value.state === "cancelled") dataCounts.cancelled++
      return value.state !== "cancelled" || body.include_cancelled ? [{ ticket: value, stage, context: null, adopted_context: null }] : []
    })
    // Counts and row order are supplied by the mock authority, never a browser
    // sort/filter. Small controlled pages exercise cursor replacement explicitly.
    const offset = body.cursor?.offset ?? 0
    const pageRows = options.pagination ? rows.slice(offset, offset + 1) : rows
    const more = options.pagination && offset + pageRows.length < rows.length
    return { ...envelope(seq, { project_id: projectId, counts: dataCounts, rows: pageRows }),
      truncated: more, omitted_count: more ? rows.length - offset - pageRows.length : 0,
      next_cursor: more ? { commit: snapshot(seq).commit, query_hash: `mock-filter-${filter ? JSON.stringify(filter) : "all"}`, offset: offset + pageRows.length } : null }
  }
  function inspect(id: string) {
    const sprint = sprints[id]
    const current = Object.fromEntries(sprint.members.map((member: string) => [member, clone(versions[member])]))
    const values = Object.values(current) as any[]
    const currentCounts = counts(values.length, values.filter((value) => value.accepted).length,
      values.filter((value) => !value.accepted && value.state !== "cancelled").length,
      values.filter((value) => value.state === "blocked").length, values.filter((value) => value.state === "cancelled").length)
    return envelope(seq, { sprint: clone(sprint), current_members: current, current_counts: currentCounts })
  }
  function commit(body: any) {
    seq++
    const action = body.action
    let closure: any = null
    if (action.op === "create") {
      sprints[body.sprint_id] = { id: body.sprint_id, project_id: projectId, definition: clone(action.definition), status: "planned", revision: 1,
        created_seq: seq, updated_seq: seq, members: [], history: [], closure: null }
    } else if (action.op === "edit") {
      sprints[body.sprint_id].definition = clone(action.definition)
      sprints[body.sprint_id].revision++
      sprints[body.sprint_id].updated_seq = seq
    } else if (action.op === "close") {
      const sprint = sprints[body.sprint_id]
      const members = Object.fromEntries(sprint.members.map((id: string) => {
        const version = clone(versions[id])
        const destination = action.dispositions[id]
        const disposition = version.accepted ? { disposition: "accepted" } : version.state === "cancelled" ? { disposition: "cancelled" }
          : destination.destination === "backlog" ? { disposition: "backlog" } : { disposition: "sprint", sprint_id: destination.sprint_id }
        if (destination?.destination === "sprint") {
          sprints[destination.sprint_id].members.push(id)
          sprints[destination.sprint_id].revision++
          sprints[destination.sprint_id].updated_seq = seq
        }
        if (destination) sprint.history.push({ work_id: id, work_revision: version.record_revision, seq, operation_id: body.operation_id,
          principal: "user:host-owner", source: body.source, change: { kind: "carried_out", to: destination.sprint_id ?? null } })
        return [id, { version, disposition }]
      }))
      closure = { source_commit: snapshot(body.expected_seq).commit, source_seq: body.expected_seq, closed_seq: seq, members, counts: counts(4, 1, 2, 1, 1) }
      sprint.status = "closed"; sprint.revision++; sprint.updated_seq = seq; sprint.closure = closure
    }
    const canonical = JSON.stringify(canonicalValue(["sprint", body]))
    return { operation: { operation_id: body.operation_id, principal: "user:host-owner", request_hash: sha256(canonical), canonical_request: canonical, committed_seq: seq, ids: { sprint: body.sprint_id } }, closure }
  }
  return {
    board, inspect,
    list: () => envelope(seq, Object.values(sprints).map(summary)),
    scope: () => ({ available: true, mutation_enabled: true, dispatch_enabled: false, capabilities: { ticket_scope_v1: true }, binding: clone(binding), overview: envelope(seq, {}) }),
    command: (body: any) => {
      commandAttempts++
      if (options.conflictOnce && commandAttempts === 1) { seq = 8; return { status: 409, json: { error: "revision_conflict" } } }
      if (options.unknownThenDenied && commandAttempts === 1) { savedReceipt = commit(body); return { status: 503, json: { error: "controlled ambiguous outcome" } } }
      if (options.unknownThenDenied && commandAttempts === 2) return { status: 403, json: { error: "controlled owner access denied during exact retry" } }
      return { status: 200, json: savedReceipt ?? commit(body) }
    },
    workVersion: (id: string) => clone(versions[id]),
  }
}

async function installMock(page: Page, options: MockOptions = {}) {
  const model = createModel(options)
  const records: ApiRecord[] = []
  const blocked: string[] = []
  const pageErrors: string[] = []
  const consoles: { text: string; url: string }[] = []
  page.on("pageerror", (failure) => pageErrors.push(failure.message))
  page.on("console", (message) => { if (message.type() === "error") consoles.push({ text: message.text(), url: message.location().url }) })
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== "http://127.0.0.1:19576" || /^\/(api|v2|ws)(\/|$)/.test(url.pathname)) {
      blocked.push(`${route.request().method()} ${url.origin}${url.pathname}`)
      await route.abort("blockedbyclient")
    } else await route.fallback()
  })
  await page.routeWebSocket("**", (socket) => {
    const url = new URL(socket.url())
    if (url.host === "127.0.0.1:19576" && !/^\/(api|v2|ws)(\/|$)/.test(url.pathname)) socket.connectToServer()
    else { blocked.push(`WEBSOCKET ${url.origin}${url.pathname}`); socket.close() }
  })
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    const body = request.method() === "POST" ? request.postDataJSON() : null
    const record: ApiRecord = { method: request.method(), path: pathname, body, rawBody: request.postData() }
    records.push(record)
    const respond = async (json: unknown, status = 200) => { record.status = status; await route.fulfill({ status, json }) }
    if (request.method() === "POST" && pathname === "/api/v1/tickets/project-board") {
      if (body.project_id !== projectId || (options.denyFilter && body.sprint_filter?.kind === "sprint")) await respond({ error: "scope_denied: Sprint Project mismatch" }, 403)
      else await respond(model.board(body))
    } else if (request.method() === "GET" && pathname === "/api/v1/tickets/scope") await respond(model.scope())
    else if (request.method() === "POST" && pathname === "/api/v1/tickets/sprints/list") {
      if (options.unavailable) await respond({ error: "not found" }, 404)
      else await respond(model.list())
    } else if (request.method() === "POST" && pathname === "/api/v1/tickets/sprints/inspect") {
      await respond(model.inspect(body.sprint_id))
    } else if (request.method() === "POST" && pathname === "/api/v1/tickets/sprints/command") {
      const result = model.command(body)
      await respond(result.json, result.status)
    } else { blocked.push(`${request.method()} ${pathname}`); await route.abort("blockedbyclient") }
  })
  return { model, records, blocked, pageErrors, consoles }
}
type Mock = Awaited<ReturnType<typeof installMock>>
const boardRequests = (mock: Mock) => mock.records.filter((record) => record.path.endsWith("/project-board"))
const commands = (mock: Mock) => mock.records.filter((record) => record.path.endsWith("/sprints/command"))
const board = (page: Page) => page.getByTestId("project-work-board")
const controls = (page: Page) => page.getByTestId("sprint-owner-controls")
const filter = (page: Page) => page.getByTestId("project-sprint-filter")
async function open(page: Page, theme = "light", locale = "zh-CN") {
  await page.goto(`/e2e/fixtures/project-sprints.html?theme=${theme}&locale=${locale}&source=${initialSource.head.slice(0, 12)}%2Buncommitted`)
  await expect(page.getByTestId(`project-work-${workId}`)).toBeVisible()
  await expect(filter(page).locator('option[value="sprint:a"]')).toHaveCount(1)
}
async function selectSprint(page: Page, id: string) {
  await filter(page).selectOption(`sprint:${id}`)
  await expect(page.getByTestId("project-sprint-summary")).toBeVisible()
  await expect(controls(page)).toBeVisible()
}
async function recordEvidence(page: Page, mock: Mock, info: TestInfo, screenshotName?: string) {
  await mkdir(path.join(output, "cases"), { recursive: true })
  const unexpectedConsole = mock.consoles.filter((entry) => !/^Failed to load resource: the server responded with a status of (403|404|409|503)\b/.test(entry.text))
  const result = { case: info.title, mode: "controlled-mock-http-real-parent-components", source: initialSource,
    producer_source: payload.source_sha, producer_payload_sha256: sha256(readFileSync("src/test/fixtures/sprintContract/producer-http-payload.json")),
    viewport: page.viewportSize(), device_scale_factor: await page.evaluate("window.devicePixelRatio"), theme: await page.locator("html").evaluate((element) => element.classList.contains("dark") ? "dark" : "light"),
    records: mock.records, blocked: mock.blocked, pageErrors: mock.pageErrors, consoleErrors: mock.consoles, unexpectedConsole }
  await writeFile(path.join(output, "cases", `${info.title.replace(/[^a-zA-Z0-9-]+/g, "-")}.json`), JSON.stringify(result, null, 2) + "\n")
  expect(mock.blocked).toEqual([])
  expect(mock.pageErrors).toEqual([])
  expect(unexpectedConsole).toEqual([])
  if (screenshotName) {
    await mkdir(path.join(output, "screenshots"), { recursive: true })
    const screenshot = path.join(output, "screenshots", screenshotName)
    await page.screenshot({ path: screenshot, fullPage: true, animations: "disabled" })
    await info.attach("mock-parent-screenshot", { path: screenshot, contentType: "image/png" })
    await writeFile(`${screenshot}.json`, JSON.stringify({ ...result, screenshot, screenshot_sha256: sha256(readFileSync(screenshot)) }, null, 2) + "\n")
  }
}
test.beforeAll(async () => { await mkdir(output, { recursive: true }); await writeFile(path.join(output, "source-before.json"), JSON.stringify(initialSource, null, 2) + "\n") })
test.afterAll(async () => { await writeFile(path.join(output, "source-after.json"), JSON.stringify(sourceProof(), null, 2) + "\n") })

for (const width of [1440, 390]) for (const theme of ["light", "dark"]) {
  test(`${theme}-${width} parent reads current and closing facts without horizontal overflow`, async ({ page }, info) => {
    const mock = await installMock(page)
    await page.setViewportSize({ width, height: 1000 })
    await open(page, theme)
    await selectSprint(page, "c")
    await expect(page.getByTestId("project-sprint-current-counts")).toContainText("已验收 1")
    await expect(page.getByTestId("project-sprint-closure-counts")).toContainText("已验收 0")
    await expect(page.getByTestId("project-sprint-closure-counts")).toContainText("未完成 1")
    await expect(page.getByTestId(`project-work-${historicalId}`)).toContainText("已验收")
    await page.getByText("成员变更历史", { exact: false }).click()
    await expect(page.getByTestId("project-sprint-summary")).toContainText("转出")
    await expect(page.getByTestId("project-sprint-summary")).toContainText(historicalId)
    await expect(controls(page)).toContainText("此 Sprint 已关闭")
    await expect(controls(page).getByRole("button", { name: "关闭 Sprint", exact: true })).toHaveCount(0)
    expect(await page.locator("html").evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
    expect(commands(mock)).toHaveLength(0)
    await recordEvidence(page, mock, info, `sprint-parent-unfrozen-${width}x1000-${theme}-mock.png`)
  })
}

test("keyboard filter selection always replaces the previous membership cursor", async ({ page }, info) => {
  const mock = await installMock(page, { pagination: true, keyboardNames: true })
  await open(page, "light", "en-US")
  // Native collapsed-select typeahead and Tab commit use real keyboard input.
  // This avoids macOS native popup navigation, which is not dispatched by this
  // headless Chromium build; no value/property/change event is injected.
  await filter(page).focus()
  await page.keyboard.press("b")
  await page.keyboard.press("Tab")
  await expect(filter(page)).toHaveValue("backlog")
  await expect(page.getByTestId(`project-work-${backlogId}`)).toBeVisible()
  await expect.poll(() => boardRequests(mock).at(-1)?.body.sprint_filter).toEqual({ kind: "backlog" })
  expect(boardRequests(mock).at(-1)?.body).toMatchObject({ cursor: null, fixed_commit: null })
  await expect(filter(page).locator('option[value="sprint:a"]')).toHaveCount(1)
  await filter(page).focus(); await page.keyboard.press("s"); await page.keyboard.press("Tab")
  await expect(filter(page)).toHaveValue("sprint:a")
  await expect(page.getByTestId(`project-work-${workId}`)).toBeVisible()
  await expect.poll(() => boardRequests(mock).at(-1)?.body.sprint_filter).toEqual({ kind: "sprint", sprint_id: "a" })
  expect(boardRequests(mock).at(-1)?.body).toMatchObject({ cursor: null, fixed_commit: null })
  const sprintLists = mock.records.filter((record) => record.path.endsWith("/sprints/list"))
  expect(sprintLists.every((record) => record.body.cursor === null && record.body.fixed_commit === snapshot(7).commit)).toBe(true)
  expect(boardRequests(mock).every((record) => record.body.cursor === null)).toBe(true)
  await recordEvidence(page, mock, info)
})

test("explicit close covers every unfinished destination and preserves Work execution facts", async ({ page }, info) => {
  const mock = await installMock(page)
  await open(page)
  await selectSprint(page, "a")
  const before = mock.model.workVersion(workId)
  const close = controls(page).getByRole("button", { name: "关闭 Sprint", exact: true })
  await expect(close).toBeDisabled()
  await controls(page).getByRole("combobox", { name: new RegExp(`^Work 去向: ${workId}`) }).selectOption("backlog")
  await expect(close).toBeDisabled()
  await controls(page).getByRole("combobox", { name: new RegExp(`^Work 去向: ${blockedId}`) }).selectOption("sprint:b")
  await expect(close).toBeEnabled()
  await close.click()
  await expect.poll(() => commands(mock).length).toBe(1)
  const body = commands(mock)[0].body
  expect(body).toMatchObject({ project_id: projectId, sprint_id: "a", binding, expected_seq: 7, expected_epoch: 1, source: "Explicit owner Sprint planning",
    action: { op: "close", expected_revision: 3, dispositions: { [workId]: { destination: "backlog" }, [blockedId]: { destination: "sprint", sprint_id: "b" } }, target_revisions: { b: 2 } } })
  expect(Object.keys(body.action.dispositions).sort()).toEqual([workId, blockedId].sort())
  expect(body.operation_id).toMatch(/^[a-f0-9-]{36}$/)
  await expect(controls(page)).toContainText("此 Sprint 已关闭")
  await expect(page.getByTestId(`project-work-${workId}`)).toContainText("执行中")
  expect(mock.model.workVersion(workId)).toEqual(before)
  expect(commands(mock)).toHaveLength(1)
  await recordEvidence(page, mock, info)
})

test("create conflict keeps draft and stable Sprint ID across the real parent refresh", async ({ page }, info) => {
  const mock = await installMock(page, { conflictOnce: true })
  await open(page)
  const name = controls(page).getByRole("textbox", { name: "Sprint 名称", exact: true })
  const goal = controls(page).getByRole("textbox", { name: "Sprint 目标", exact: true })
  await expect(name).toBeEnabled()
  await name.fill("409 后仍保留的草稿名称")
  await goal.fill("保留草稿和首次生成的 Sprint ID；只有用户再次明确提交才使用新快照。")
  await controls(page).getByRole("button", { name: "创建 Sprint", exact: true }).click()
  await expect(controls(page)).toContainText("规划已发生并发变更")
  expect(commands(mock)).toHaveLength(1)
  const first = clone(commands(mock)[0].body)
  expect(first).toMatchObject({ expected_seq: 7, expected_epoch: 1, action: { op: "create" } })
  await controls(page).getByRole("button", { name: "重新核对最新 Sprint", exact: true }).click()
  await expect.poll(() => boardRequests(mock).at(-1)?.status).toBe(200)
  await expect(name).toHaveValue("409 后仍保留的草稿名称")
  await expect(goal).toHaveValue("保留草稿和首次生成的 Sprint ID；只有用户再次明确提交才使用新快照。")
  await expect(controls(page).getByRole("button", { name: "创建 Sprint", exact: true })).toBeEnabled()
  expect(commands(mock)).toHaveLength(1)
  await controls(page).getByRole("button", { name: "创建 Sprint", exact: true }).click()
  await expect.poll(() => commands(mock).length).toBe(2)
  const second = commands(mock)[1].body
  expect(second.sprint_id).toBe(first.sprint_id)
  expect(second.operation_id).not.toBe(first.operation_id)
  expect(second.action.definition).toEqual(first.action.definition)
  expect(second.expected_seq).toBe(8)
  await expect(controls(page)).toContainText("规划命令已提交")
  await recordEvidence(page, mock, info)
})

test("unknown command survives reopening and a denied explicit check retains the exact original body", async ({ page }, info) => {
  const mock = await installMock(page, { unknownThenDenied: true })
  await open(page)
  await selectSprint(page, "a")
  await controls(page).getByLabel("Sprint 名称", { exact: true }).fill("未知结果必须核查原命令")
  await controls(page).getByRole("button", { name: "保存 Sprint 定义", exact: true }).click()
  await expect(controls(page)).toContainText("命令结果未知")
  expect(commands(mock)).toHaveLength(1)
  const first = commands(mock)[0]
  await page.getByTestId("fixture-toggle-board").click()
  await expect(board(page)).toHaveCount(0)
  await page.getByTestId("fixture-toggle-board").click()
  await expect(page.getByTestId(`project-work-${workId}`)).toBeVisible()
  await expect(controls(page)).toContainText("命令结果未知")
  await controls(page).getByRole("button", { name: "核查原命令", exact: true }).click()
  await expect.poll(() => commands(mock).length).toBe(2)
  await expect(controls(page)).toContainText("命令结果未知")
  expect(commands(mock)[1].rawBody).toBe(first.rawBody)
  await controls(page).getByRole("button", { name: "核查原命令", exact: true }).click()
  await expect.poll(() => commands(mock).length).toBe(3)
  await expect(controls(page)).toContainText("规划命令已提交")
  expect(commands(mock).every((record) => record.rawBody === first.rawBody)).toBe(true)
  expect(commands(mock).every((record) => record.body.operation_id === first.body.operation_id && record.body.expected_seq === 7)).toBe(true)
  await recordEvidence(page, mock, info)
})

test("missing Sprint routes keep All Work readable and planning controls unsupported", async ({ page }, info) => {
  const mock = await installMock(page, { unavailable: true })
  await page.goto("/e2e/fixtures/project-sprints.html?theme=light&source=unfrozen-mock")
  await expect(page.getByTestId(`project-work-${workId}`)).toBeVisible()
  await expect(page.getByTestId("project-sprint-panel")).toContainText("当前后端不支持 Sprint 规划")
  await expect(filter(page).locator('option[value="backlog"]')).toHaveAttribute("disabled", "")
  await expect(controls(page)).toHaveCount(0)
  expect(commands(mock)).toHaveLength(0)
  expect(boardRequests(mock).every((record) => !record.body.sprint_filter)).toBe(true)
  await recordEvidence(page, mock, info)
})

test("membership scope denial hides filtered Work and lets the owner explicitly recover All Work", async ({ page }, info) => {
  const mock = await installMock(page, { denyFilter: true })
  await open(page)
  await filter(page).selectOption("sprint:a")
  await expect(board(page).getByRole("alert")).toBeVisible()
  await expect(page.getByTestId(`project-work-${workId}`)).toHaveCount(0)
  await expect(controls(page)).toHaveCount(0)
  expect(commands(mock)).toHaveLength(0)
  await filter(page).selectOption("all")
  await expect(page.getByTestId(`project-work-${workId}`)).toBeVisible()
  expect(boardRequests(mock).at(-1)?.body).toMatchObject({ cursor: null, fixed_commit: null })
  expect(boardRequests(mock).at(-1)?.body.sprint_filter).toBeUndefined()
  await recordEvidence(page, mock, info)
})
