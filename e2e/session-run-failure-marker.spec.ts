import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const failedId = "failed-run-session"
const healthyId = "healthy-session"
const at = "2026-10-31T00:00:00Z"
const detail = "Provider upstream returned 502"

const sessions = [
  {
    id: failedId, title: "生成中断的会话", title_version: 1, kind: "root", root_session_id: failedId,
    parent_session_id: null, spawn_depth: 0, pinned: true, message_count: 2,
    model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
    created_at: at, updated_at: at, last_activity_at: at, is_running: false,
    // A finished run that ended in failure: this is what the sidebar must surface.
    last_run_status: "error", last_run_error: detail,
    has_pending_question: false, subagent_count: 0,
  },
  {
    id: healthyId, title: "正常完成的会话", title_version: 1, kind: "root", root_session_id: healthyId,
    parent_session_id: null, spawn_depth: 0, pinned: false, message_count: 2,
    model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
    created_at: at, updated_at: at, last_activity_at: at, is_running: false,
    last_run_status: "completed", last_run_error: null,
    has_pending_question: false, subagent_count: 0,
  },
]

test("the sidebar marks a session whose last run failed in red, and only that session", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-chromium", "one desktop pass covers the sidebar marker")
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.addInitScript((id) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", id)
  }, healthyId)
  await installArtifactRuntime(page, standaloneScenario)
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() === "GET" && path === "/api/v1/sessions") {
      await route.fulfill({ json: { sessions, total: sessions.length, limit: 200, offset: 0 } })
    } else if (request.method() === "GET" && path === `/api/v1/sessions/${healthyId}`) {
      await route.fulfill({ json: { session: sessions[1] }, headers: { ETag: '"1"' } })
    } else if (request.method() === "GET" && path === `/api/v1/history/${healthyId}`) {
      await route.fulfill({ json: { session_id: healthyId, messages: [
        { id: "healthy-request", role: "user", content: "Run the healthy fixture.", created_at: at },
        { id: "healthy-answer", role: "assistant", content: "The healthy fixture completed.", created_at: at },
      ] } })
    } else if (path === `/api/v1/respond/${healthyId}/pending`) {
      await route.fulfill({ json: { has_pending_question: false } })
    } else await route.fallback()
  })
  await page.goto(standaloneScenario.entryUrl)
  await expect(page.getByRole("banner")).toContainText(sessions[1]!.title)

  const failedRow = page.locator(`[data-sidebar-session="${failedId}"]`)
  const healthyRow = page.locator(`[data-sidebar-session="${healthyId}"]`)
  const marker = failedRow.locator("[data-session-run-failure]")
  // The verbatim backend cause is the row's explanation; a successful run shows nothing.
  await expect(marker).toBeVisible()
  await expect(marker).toHaveAttribute("title", detail)
  await expect(healthyRow.locator("[data-session-run-failure]")).toHaveCount(0)

  // The marker must render the destructive token, not the blue unread/running one.
  const colors = await marker.locator("svg").evaluate((svg) => {
    const doc = svg.ownerDocument
    const view = doc.defaultView!
    const probe = (className: string) => {
      const element = doc.createElement("span")
      element.className = className
      element.style.position = "absolute"
      doc.body.appendChild(element)
      const color = view.getComputedStyle(element).color
      element.remove()
      return color
    }
    return { destructive: probe("text-destructive"), primary: probe("text-primary"), actual: view.getComputedStyle(svg).color }
  })
  expect(colors.actual).toBe(colors.destructive)
  expect(colors.actual).not.toBe(colors.primary)

  // The failure is described for assistive tech, and both rows keep one aligned slot.
  const describedBy = await failedRow.locator("button").first().getAttribute("aria-describedby")
  expect(describedBy).toBeTruthy()
  for (const id of describedBy!.split(" ")) {
    // React ids contain colons, so match on the attribute rather than a CSS id.
    await expect(failedRow.locator(`[id="${id}"]`)).not.toBeEmpty()
  }
  const boxes = await Promise.all([failedRow, healthyRow].map((row) => row.locator("button > span").first().boundingBox()))
  expect(Math.abs((boxes[0]!.width) - (boxes[1]!.width))).toBeLessThan(0.5)

  await info.attach("sidebar-failed-run-marker", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" })
})
