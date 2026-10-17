import { mkdir } from "node:fs/promises"
import { expect, test } from "@playwright/test"

const snapshot = { commit: "synthetic-host-snapshot", seq: 19, authority_epoch: 4 }
const ticket = { id: "synthetic-work-1", kind: "work", state: "active", generation: 3, record_revision: 8, contract_revision: 5,
  updated_seq: 19, archived: false, scope_id: "synthetic-scope", depends_on: [], paused: false,
  contract: { title: "核对长文字与受控接线，保留原始草稿和固定快照", objective: "这是一条合成工单，用于检查当前父看板的接线、中文长文与窄屏布局。没有调用真实后端写操作，也没有启动工作进程。", constraints: ["保存回调仅返回收据"], acceptance: ["用户验收不冒充自动测试通过"] },
  blocked: null, active_assignment: null, current_submission: null, accepted_submission: null }
const envelope = { snapshot, index_seq: 19, coverage: "complete", truncated: false, omitted_count: 0, next_cursor: null }
for (const [theme, width] of [["light", 1440], ["dark", 390]] as const) {
  test(`${theme} ${width}px controlled parent slots preserve copy, CAS and read-only APIs`, async ({ page }) => {
    const unexpected: string[] = []
    const pageErrors: string[] = []
    page.on("pageerror", (error) => pageErrors.push(error.message))
    await page.route("**/api/v1/**", async (route) => {
      const request = route.request()
      const path = new URL(request.url()).pathname
      if (request.method() === "POST" && path.endsWith("/tickets/project-board")) {
        await route.fulfill({ json: { ...envelope, data: { project_id: "synthetic-project",
          counts: { todo: 0, doing: 1, testing: 0, done: 0, blocked: 0, cancelled: 0, total: 1 }, rows: [{ ticket, stage: "doing", context: null, adopted_context: null }] } } })
      } else if (request.method() === "POST" && path.endsWith("/tickets/inspect")) {
        expect(request.postDataJSON()).toMatchObject({ ids: [ticket.id], sections: ["assignments", "requests", "submissions"], fixed_commit: snapshot.commit })
        await route.fulfill({ json: { ...envelope, data: [{ ticket, assignments: [], requests: [], submissions: [] }] } })
      } else { unexpected.push(`${request.method()} ${path}`); await route.abort("blockedbyclient") }
    })
    await page.setViewportSize({ width, height: 900 })
    await page.goto(`/e2e/fixtures/project-work-board-controls.html?theme=${theme}`)
    await page.getByTestId("project-work-synthetic-work-1").click()
    const planning = page.getByTestId("project-work-planning-controls")
    await expect(planning.getByRole("heading", { name: "工单规划", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "以用户身份验收", exact: true })).toBeDisabled()
    await planning.getByRole("button", { name: "清除预期时间", exact: true }).click()
    await planning.getByRole("button", { name: "请求更新规划", exact: true }).click()
    await expect(planning.getByRole("button", { name: "请求更新规划", exact: true })).toBeDisabled()
    await expect(page.getByTestId("work-authoritative-state")).toHaveText("执行中")
    const log = JSON.parse(await page.getByTestId("host-callback-log").textContent() ?? "[]")
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ value: { priority: "high", expectedCompletionAt: null }, context: { operationId: "synthetic-plan-1", recordRevision: 8, expectedSeq: 19, expectedEpoch: 4, binding: { scope_id: "synthetic-scope" } } })
    expect(await page.locator("html").evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
    expect(unexpected).toEqual([])
    expect(pageErrors).toEqual([])
    await mkdir("test-results/project-work-board-host", { recursive: true })
    await page.screenshot({ path: `test-results/project-work-board-host/${theme}-${width}.png`, fullPage: true, animations: "disabled" })
  })
}
