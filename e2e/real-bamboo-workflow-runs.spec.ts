import assert from "node:assert/strict"
import { execFile, spawn } from "node:child_process"
import { promisify } from "node:util"
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test"
import { REAL_BAMBOO_REVISION } from "./support/realBambooRuntime.ts"
import { restartRealBamboo } from "./support/restartRealBamboo.ts"
import { observePage } from "./support/pageObservation.ts"

const exec = promisify(execFile)
const required = (name: string) => { const value = process.env[name]; assert.ok(value, `Missing ${name}`); return value }
type Run = { run_id: string; session_id: string; status: string; workflow_id: string; workflow_revision: number; last_sequence: number;
  steps: Record<string, { id: string; status: string }> }

/** Seed only this already-owned lane's disposable container, never a host data directory. */
async function seedWorkflowFixtures() {
  const id = required("LOTUS_REAL_BAMBOO_CONTAINER_ID"), runId = required("LOTUS_REAL_BAMBOO_RUN_ID")
  assert.match(id, /^[a-f0-9]{64}$/); assert.match(runId, /^[a-f0-9]{32}$/)
  const inspected = JSON.parse((await exec("docker", ["inspect", "--format",
    '{"id":{{json .Id}},"labels":{{json .Config.Labels}},"running":{{json .State.Running}},"ports":{{json .NetworkSettings.Ports}}}', id])).stdout)
  assert.equal(inspected.id, id); assert.equal(inspected.labels["lotus.real-bamboo.run"], runId); assert.equal(inspected.running, true)
  const bindings = inspected.ports["9562/tcp"]
  assert.equal(bindings.length, 1); assert.equal(bindings[0].HostIp, "127.0.0.1")
  assert.match(bindings[0].HostPort, /^\d+$/)
  const port = Number(bindings[0].HostPort); assert.ok(port > 0 && port <= 65535)
  const current = new URL(`http://127.0.0.1:${port}`)
  const slug = `workflow-ui-${runId}`
  const budgets = { max_concurrency: 1, max_agents: 1, max_steps: 4, max_retries: 2, max_nesting_depth: 2, wall_time_ms: 30000 }
  const read = (stepId: string, pointer = "/file") => ({ id: stepId, type: "tool", tool: "Read", capabilities: ["read"],
    args: { file_path: { from: "args", pointer } } })
  const common = { workflow_schema: 1, revision: 42, invocation_policy: { explicit: true, automatic: false }, budgets,
    input_schema: { type: "object", properties: { file: { type: "string" } }, required: ["file"], additionalProperties: false } }
  const definitions = [
    { ...common, id: `${slug}-sequence`, steps: [read("inspect")], plan: { type: "sequence", nodes: [{ type: "step", step: "inspect" }] } },
    { ...common, id: `${slug}-choice`, input_schema: { type: "object", properties: { file: { type: "string" }, alternate_file: { type: "string" }, choose_primary: { type: "boolean" } },
      required: ["file", "alternate_file", "choose_primary"], additionalProperties: false }, steps: [read("primary"), read("alternate", "/alternate_file")],
      plan: { type: "choice", condition: { from: "args", pointer: "/choose_primary" },
        then_branch: { type: "step", step: "primary" }, else_branch: { type: "step", step: "alternate" } } },
    { ...common, id: `${slug}-retry`, steps: [read("read_missing")],
      plan: { type: "retry", node: { type: "step", step: "read_missing" }, max_attempts: 2, delay_ms: 15000 } },
  ]
  const payload = JSON.stringify({ slug, definitions })
  await new Promise<void>((resolve, reject) => {
    const child = spawn("docker", ["exec", "-i", id, "python3", "-c", `
import json, pathlib, sys
data = json.load(sys.stdin)
slug = data['slug']
assert slug.startswith('workflow-ui-') and len(slug) == 44
skills = pathlib.Path('/data/bamboo/skills')
for definition in data['definitions']:
    name = definition['id']
    assert name in [slug + '-sequence', slug + '-choice', slug + '-retry']
    folder = skills / name
    folder.mkdir(parents=True, exist_ok=False)
    (folder / 'SKILL.md').write_text('---\\nname: ' + name + '\\ndescription: Isolated read-only Workflow UI fixture\\n---\\nRun the isolated read-only fixture.\\n')
    (folder / 'workflow.yaml').write_text(json.dumps(definition))
for name in ['ui-primary', 'secondary']:
    workspace = pathlib.Path('/data/bamboo/workspaces') / name
    assert workspace.is_dir()
    (workspace / (slug + '.txt')).write_text('Read-only Workflow UI fixture\\n')
    (workspace / (slug + '-alternate.txt')).write_text('Alternate read-only Workflow UI fixture\\n')
`], { stdio: ["pipe", "ignore", "ignore"] })
    child.on("error", reject); child.on("close", (code) => code === 0 ? resolve() : reject(new Error("Owned Workflow fixture seed failed")))
    child.stdin.end(payload)
  })
  const restarted = await restartRealBamboo(current.origin)
  await expect.poll(async () => {
    try { return (await fetch(new URL("/readyz", restarted.baseUrl), { signal: AbortSignal.timeout(2000) })).ok } catch { return false }
  }).toBe(true)
  return { baseUrl: restarted.baseUrl, slug, restart: { startedBefore: restarted.startedBefore, startedAfter: restarted.startedAfter } }
}
async function install(context: BrowserContext, origin: string, sessionId: string) {
  await context.addInitScript(({ appOrigin, id }) => {
    if ((globalThis as unknown as { location: { origin: string } }).location.origin !== appOrigin) return
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.removeItem("copilot_backend_base_url")
    localStorage.setItem("lotus_next_backend_endpoint_v1", appOrigin)
    localStorage.setItem("lotus_next_last_session", id)
  }, { appOrigin: origin, id: sessionId })
}
async function openMain(page: Page) {
  await page.locator("header").first().getByRole("button", { name: "更多", exact: true }).click()
  await page.getByRole("menuitem", { name: "编排运行", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "编排运行", exact: true }); await expect(dialog).toBeVisible(); return dialog
}
async function json<T>(base: URL, path: string): Promise<T> {
  const response = await fetch(new URL(`/api/v1/${path}`, base), { signal: AbortSignal.timeout(5000) })
  expect(response.status).toBe(200); return response.json() as Promise<T>
}
async function start(page: Page, dialog: Locator, sessionId: string, workflowId: string, args: object) {
  await dialog.getByRole("combobox").selectOption(`user:${workflowId}:42`)
  await dialog.getByRole("textbox", { name: "编排参数（JSON）", exact: true }).fill(JSON.stringify(args))
  const response = page.waitForResponse((item) => new URL(item.url()).pathname === `/api/v1/sessions/${sessionId}/workflow-runs` && item.request().method() === "POST")
  await dialog.getByRole("button", { name: "启动运行", exact: true }).click()
  const actual = await response
  expect(actual.status()).toBe(202)
  expect(actual.request().postDataJSON()).toEqual({ workflow_id: workflowId, revision: 42, args })
  return actual.json() as Promise<Run>
}

test("session Workflow Run panel executes pinned Sequence and Choice, cancels Retry, and reopens durable state on desktop and phone", async ({ browser }, testInfo) => {
  expect(required("LOTUS_REAL_BAMBOO_REVISION")).toBe(REAL_BAMBOO_REVISION)
  const fixture = await seedWorkflowFixtures()
  const primary = required("LOTUS_REAL_BAMBOO_UI_SESSION_ID"), side = required("LOTUS_REAL_BAMBOO_OTHER_PROJECT_SESSION_ID")
  const primaryFile = `/data/bamboo/workspaces/ui-primary/${fixture.slug}.txt`
  const sideFile = `/data/bamboo/workspaces/secondary/${fixture.slug}.txt`
  const endpoint = (id: string) => `sessions/${id}/workflow-runs`
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", locale: "zh-CN" })
  await install(desktop, fixture.baseUrl.origin, primary)
  const page = await desktop.newPage(), observed = observePage(page, "workflow-runs-real-desktop")
  const cases: { label: string; run: Run }[] = []
  try {
    await page.goto(fixture.baseUrl.href)
    await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible()
    let dialog = await openMain(page)
    const sequence = await start(page, dialog, primary, `${fixture.slug}-sequence`, { file: primaryFile })
    await expect.poll(async () => (await json<Run>(fixture.baseUrl, `${endpoint(primary)}/${sequence.run_id}`)).status).toBe("succeeded")
    await expect(dialog).toContainText("已完成")
    cases.push({ label: "sequence", run: await json<Run>(fixture.baseUrl, `${endpoint(primary)}/${sequence.run_id}`) })
    await dialog.getByRole("button", { name: "关闭", exact: true }).click()
    dialog = await openMain(page)
    await expect(dialog).toContainText(sequence.run_id)
    const choice = await start(page, dialog, primary, `${fixture.slug}-choice`, { file: primaryFile, alternate_file: primaryFile.replace(".txt", "-alternate.txt"), choose_primary: true })
    await expect.poll(async () => (await json<Run>(fixture.baseUrl, `${endpoint(primary)}/${choice.run_id}`)).status).toBe("succeeded")
    const choiceSnapshot = await json<Run>(fixture.baseUrl, `${endpoint(primary)}/${choice.run_id}`)
    expect(choiceSnapshot.steps.primary.status).toBe("succeeded"); expect(choiceSnapshot.steps.alternate.status).toBe("skipped")
    await expect(dialog.getByRole("list", { name: "步骤", exact: true })).toContainText("已跳过")
    cases.push({ label: "choice-true", run: choiceSnapshot })
    const retried = await start(page, dialog, primary, `${fixture.slug}-retry`, { file: `/data/bamboo/workspaces/ui-primary/${fixture.slug}-missing.txt` })
    await expect.poll(async () => {
      const events = await json<{ type: string; name?: string }[]>(fixture.baseUrl, `${endpoint(primary)}/${retried.run_id}/events?since=0`)
      return events.some((event) => event.type === "phase" && event.name === "retry_reserved")
    }).toBe(true)
    await expect(dialog.getByRole("button", { name: "取消运行", exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath("workflow-runs-real-desktop-running.png"), animations: "disabled" })
    const cancelledResponse = page.waitForResponse((item) => new URL(item.url()).pathname === `/api/v1/${endpoint(primary)}/${retried.run_id}/cancel` && item.request().method() === "POST")
    await dialog.getByRole("button", { name: "取消运行", exact: true }).click()
    expect((await cancelledResponse).status()).toBe(200)
    await expect(dialog).toContainText("已取消")
    const cancelled = await json<Run>(fixture.baseUrl, `${endpoint(primary)}/${retried.run_id}`); expect(cancelled.status).toBe("cancelled")
    cases.push({ label: "retry-cancel", run: cancelled })
    await dialog.getByRole("button", { name: "关闭", exact: true }).click()
    await page.getByRole("button", { name: "打开侧边面板", exact: true }).click()
    const workbench = page.locator("#right-workbench")
    await workbench.getByRole("button", { name: /并排会话.*打开另一个会话/ }).click()
    await workbench.getByRole("combobox").filter({ hasText: "选择会话并排" }).click()
    await page.getByRole("option", { name: "Lotus other Project E2E", exact: true }).click()
    await workbench.getByRole("button", { name: "编排运行", exact: true }).click()
    dialog = page.getByRole("dialog", { name: "编排运行", exact: true })
    await expect(dialog).toContainText("Lotus other Project E2E")
    await expect(dialog).not.toContainText(sequence.run_id)
    const sideRun = await start(page, dialog, side, `${fixture.slug}-choice`, { file: sideFile, alternate_file: sideFile.replace(".txt", "-alternate.txt"), choose_primary: false })
    await expect.poll(async () => (await json<Run>(fixture.baseUrl, `${endpoint(side)}/${sideRun.run_id}`)).status).toBe("succeeded")
    const sideSnapshot = await json<Run>(fixture.baseUrl, `${endpoint(side)}/${sideRun.run_id}`)
    expect(sideSnapshot.steps.primary.status).toBe("skipped"); expect(sideSnapshot.steps.alternate.status).toBe("succeeded")
    await expect(dialog.getByRole("list", { name: "步骤", exact: true })).toContainText("已跳过")
    expect((await json<Run[]>(fixture.baseUrl, endpoint(primary))).some((run) => run.run_id === sideRun.run_id)).toBe(false)
    cases.push({ label: "side-choice-false", run: sideSnapshot })
    await page.screenshot({ path: testInfo.outputPath("workflow-runs-real-side-choice.png"), animations: "disabled" })
    await dialog.getByRole("button", { name: "关闭", exact: true }).click()
    await observed.drain()
    expect(observed.pageErrors).toEqual([]); expect(observed.consoleErrors).toEqual([])
    expect(observed.responses.filter((response) => response.status >= 400)).toEqual([])
    const workflowRequests = observed.requests.filter((request) => new URL(request.url).pathname.includes("/workflow-runs"))
    expect(workflowRequests.every((request) => new URL(request.url).origin === fixture.baseUrl.origin)).toBe(true)
    expect(workflowRequests.filter((request) => request.method === "POST")).toHaveLength(5)
    expect(workflowRequests.some((request) => request.url.includes("/events"))).toBe(true)
    await testInfo.attach("Real Workflow API receipt", { body: JSON.stringify({ revision: REAL_BAMBOO_REVISION, restart: fixture.restart, cases }), contentType: "application/json" })
  } finally { await observed.stop(); await desktop.close() }
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: "dark", locale: "zh-CN" })
  await install(phone, fixture.baseUrl.origin, primary)
  const mobile = await phone.newPage(), mobileObserved = observePage(mobile, "workflow-runs-real-phone")
  try {
    await mobile.goto(fixture.baseUrl.href)
    const dialog = await openMain(mobile)
    await expect(dialog).toContainText(cases.find((item) => item.label === "retry-cancel")!.run.run_id)
    await dialog.getByRole("button", { name: new RegExp(`^${fixture.slug}-choice · r42`) }).click()
    await expect(dialog.getByRole("list", { name: "步骤", exact: true })).toContainText("已跳过")
    expect(await mobile.locator("html").evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
    await mobile.screenshot({ path: testInfo.outputPath("workflow-runs-real-phone-durable-choice.png"), animations: "disabled" })
    await dialog.getByRole("button", { name: "关闭", exact: true }).click()
    await mobileObserved.drain(); expect(mobileObserved.pageErrors).toEqual([]); expect(mobileObserved.consoleErrors).toEqual([])
    expect(mobileObserved.responses.filter((response) => response.status >= 400)).toEqual([])
  } finally { await mobileObserved.stop(); await phone.close() }
})
