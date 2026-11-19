import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const sessionId = "all-surface-session"
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

test("composer shows a failed permission read and recovers only after manual refresh", async ({ page }) => {
  await page.addInitScript((id) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", id)
  }, sessionId)
  const observation = await installArtifactRuntime(page, standaloneScenario)
  let reads = 0
  await page.route(`**/api/v1/sessions/${sessionId}`, (route) => {
    reads += 1
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
  await expect(mode).toHaveText("Default")
  await expect(permission.getByRole("alert")).toHaveCount(0)
  expect(reads).toBe(readsBeforeRefresh + 1)
  const permissionWrites = () => observation.httpRequests.filter((request) => request.method === "PATCH" && request.url.endsWith(`/sessions/${sessionId}`))
  const writesBeforeSelection = permissionWrites().length
  await mode.click()
  await page.getByRole("option", { name: "Auto", exact: true }).click()
  const confirmation = page.getByRole("dialog", { name: "为当前会话启用 Auto？", exact: true })
  await expect(confirmation).toBeVisible()
  await expect(confirmation.getByRole("button", { name: "取消", exact: true })).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(confirmation).toHaveCount(0)
  await expect(mode).toBeFocused()
  await expect(mode).toHaveText("Default")
  expect(permissionWrites()).toHaveLength(writesBeforeSelection)
  expect(observation.pageErrors).toEqual([])
})

test("Supervisor can authorize new execution sessions after choosing current-session Auto", async ({ page }, testInfo) => {
  await page.addInitScript((id) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", id)
  }, sessionId)
  const observation = await installArtifactRuntime(page, standaloneScenario)
  let revision = 7
  let dispatchAuto = false
  const writes: unknown[] = []
  await page.route(`**/api/v1/sessions/${sessionId}`, async (route) => {
    if (route.request().method() === "PATCH") {
      expect(route.request().headers()["if-match"]).toBe(`"${revision}"`)
      const update = route.request().postDataJSON()
      writes.push(update)
      revision += 1
      dispatchAuto = update.supervisor_auto_dispatch === true
    }
    await route.fulfill({
      headers: { ETag: `"${revision}"` },
      json: { session: { ...session, title: "Supervisor", permission_mode: "auto", supervisor_auto_dispatch: dispatchAuto } },
    })
  })
  await page.goto(standaloneScenario.entryUrl)
  const permission = page.locator('[data-variant="composer"][aria-label="会话权限"]')
  const mode = permission.getByRole("combobox", { name: "权限模式" })
  await expect(mode).toHaveText("Auto")
  await mode.click()
  await page.getByRole("option", { name: "Auto（含新执行会话）", exact: true }).click()
  const confirmation = page.getByRole("dialog", { name: "为新执行会话启用 Auto？" })
  await expect(confirmation).toContainText("及它新建的执行会话可直接运行工具")
  expect(writes).toEqual([])
  await testInfo.attach("supervisor-auto-dispatch-confirmation", { body: await confirmation.screenshot(), contentType: "image/png" })
  await confirmation.getByRole("button", { name: "为派发启用 Auto" }).click()
  await expect(mode).toHaveText("Auto（含新执行会话）")
  expect(writes).toEqual([{ permission_mode: "auto", supervisor_auto_dispatch: true }])
  await mode.click()
  await page.getByRole("option", { name: "Auto", exact: true }).click()
  await expect(mode).toHaveText("Auto")
  await expect(confirmation).toHaveCount(0)
  expect(writes).toEqual([{ permission_mode: "auto", supervisor_auto_dispatch: true }, { permission_mode: "auto" }])
  expect(observation.pageErrors).toEqual([])
})
