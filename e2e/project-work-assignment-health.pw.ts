import { readFileSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { resolve } from "node:path"
import { expect, test } from "@playwright/test"

const capture = (name: string) => JSON.parse(readFileSync(resolve("src/test/fixtures/projectWorkAssignmentContract", name), "utf8"))
for (const scenario of [
  { name: "active", theme: "light", width: 1440, stopped: false, sessionStatus: 200 },
  { name: "stopped-missing", theme: "dark", width: 390, stopped: true, sessionStatus: 404 },
  { name: "active-denied", theme: "dark", width: 390, stopped: false, sessionStatus: 403 },
] as const) {
  test(`${scenario.name}: pinned history and exact access in the actual parent`, async ({ page }) => {
    const board = capture(`${scenario.stopped ? "stopped" : "active"}-board.json`)
    const inspect = capture(`${scenario.stopped ? "stopped" : "active"}-inspect.json`)
    const work = inspect.data[0].ticket
    const assignment = inspect.data[0].assignments[0]
    const unexpected: string[] = []
    const errors: string[] = []
    let sessionReads = 0
    page.on("pageerror", (error) => errors.push(error.message))
    await page.route("**/api/v1/**", async (route) => {
      const request = route.request()
      const path = new URL(request.url()).pathname
      if (request.method() === "POST" && path.endsWith("/tickets/project-board")) {
        expect(request.postDataJSON().project_id).toBe(board.data.project_id)
        await route.fulfill({ json: board })
      } else if (request.method() === "POST" && path.endsWith("/tickets/inspect")) {
        expect(request.postDataJSON()).toMatchObject({ ids: [work.id], sections: ["assignments", "requests", "submissions"], fixed_commit: board.snapshot.commit })
        await route.fulfill({ json: inspect })
      } else if (request.method() === "GET" && path.endsWith(`/sessions/${encodeURIComponent(assignment.runtime.session_id)}`)) {
        sessionReads++
        // Session access is a separate controlled response. The original real
        // HTTP runtime record did not prove a persisted synthetic-worker Session.
        await route.fulfill({ status: scenario.sessionStatus, json: scenario.sessionStatus === 200
          ? { session: { id: assignment.runtime.session_id, kind: "child", project_id: board.data.project_id } }
          : { error: "Synthetic access fixture" } })
      } else if ((request.method() === "POST" && path.endsWith("/tickets/sprints/list")) || (request.method() === "GET" && path.endsWith("/tickets/scope"))) {
        // This older fixture deliberately has no Sprint capability. New read
        // probes must preserve its original All Work behavior.
        await route.fulfill({ status: 404, json: { error: "Sprint planning unavailable in this legacy fixture" } })
      } else { unexpected.push(`${request.method()} ${path}`); await route.abort("blockedbyclient") }
    })
    await page.setViewportSize({ width: scenario.width, height: 900 })
    await page.goto(`/e2e/fixtures/project-work-board-controls.html?project=${encodeURIComponent(board.data.project_id)}&theme=${scenario.theme}`)
    await page.getByTestId(`project-work-${work.id}`).click()
    const panel = page.getByTestId("assignment-health-panel")
    await expect(panel).toBeVisible()
    await expect.poll(() => sessionReads).toBe(1)
    await expect(page.getByTestId("assignment-observation-status")).toHaveText("暂不支持")
    if (scenario.stopped) {
      await page.getByTestId("assignment-history").locator("summary").click()
      await expect(page.getByTestId("assignment-history")).toContainText(assignment.id)
      await expect(page.getByTestId("assignment-history")).toContainText(assignment.runtime.session_id)
      await expect(page.getByTestId("assignment-history")).toContainText("已确认进程停止")
      await expect(panel).toContainText("会话已不存在")
    } else if (scenario.sessionStatus === 200) {
      await panel.getByRole("button", { name: "打开已核验会话", exact: true }).click()
      await expect.poll(() => sessionReads).toBe(2)
      await expect(page.getByTestId("host-callback-log")).toHaveText(JSON.stringify([{ kind: "open_session", sessionId: assignment.runtime.session_id }]))
    } else {
      await expect(panel).toContainText("无权访问此会话")
      await expect(panel.getByRole("button", { name: "打开已核验会话", exact: true })).toHaveCount(0)
    }
    expect(await page.locator("html").evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
    expect(unexpected).toEqual([]); expect(errors).toEqual([])
    await mkdir("test-results/project-work-health-host", { recursive: true })
    await page.screenshot({ path: `test-results/project-work-health-host/${scenario.name}-${scenario.theme}-${scenario.width}.png`, fullPage: true, animations: "disabled" })
  })
}
