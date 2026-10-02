import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const sessionId = "all-surface-session"

test("composer shows a failed permission read and recovers only after manual refresh", async ({ page }) => {
  await page.addInitScript((id) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", id)
  }, sessionId)
  const observation = await installArtifactRuntime(page, standaloneScenario)
  let reads = 0
  await page.route(`**/api/v1/sessions/${sessionId}`, (route) => {
    reads += 1
    const session = {
      id: sessionId, title: "Permission mode acceptance", kind: "root", title_version: 1,
      root_session_id: sessionId, parent_session_id: null, spawn_depth: 0,
      model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
      permission_mode: "default", thinking_mode: "standard", root_orchestration_only: false,
      root_mode_transition_epoch: 0, root_mode_birth_token: "a".repeat(64),
      created_at: "2026-09-26T00:00:00.000Z", updated_at: "2026-09-26T00:00:00.000Z",
      last_activity_at: "2026-09-26T00:00:00.000Z", message_count: 0,
      has_attachments: false, is_running: false, last_run_status: "completed",
    }
    return route.fulfill({ json: { session }, ...(reads === 1 ? {} : { headers: { ETag: '"7"' } }) })
  })
  await page.goto(standaloneScenario.entryUrl)
  const permission = page.locator('[data-variant="composer"][aria-label="会话权限"]')
  const mode = permission.getByRole("combobox", { name: "权限模式" })
  await expect(permission.getByRole("alert")).toBeVisible()
  await expect(permission.getByRole("alert")).toContainText("暂不能更改权限")
  await expect(mode).toBeDisabled()
  const readsBeforeRefresh = reads
  await permission.getByRole("button", { name: "刷新权限模式" }).click()
  await expect(mode).toBeEnabled()
  await expect(mode).toHaveValue("default")
  await expect(permission.getByRole("alert")).toHaveCount(0)
  expect(reads).toBe(readsBeforeRefresh + 1)
  expect(observation.pageErrors).toEqual([])
})
