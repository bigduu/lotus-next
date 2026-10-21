import { expect, test, type Page } from "@playwright/test"
import { actorSnapshotFixture } from "../src/test/fixtures/actorSnapshot.js"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"
import { expectComposerText } from "./support/composer.js"

const mainId = "all-surface-session"
const at = "2026-10-06T00:00:00.000Z"

async function setup(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", "all-surface-session")
  })
  const observation = await installArtifactRuntime(page, standaloneScenario)
  const sessions = [
    { id: mainId, title: "Command main", child: false },
    { id: "command-chinese-a", title: "中文会话一", child: false },
    { id: "command-chinese-b", title: "中文会话二", child: false },
    { id: "command-child", title: "中文子会话", child: true },
  ].map(({ child, ...session }) => ({
    ...session, kind: child ? "child" : "root", title_version: 1, pinned: false,
    root_session_id: child ? mainId : session.id, parent_session_id: child ? mainId : null,
    spawn_depth: child ? 1 : 0, root_orchestration_only: false, thinking_mode: "standard",
    root_mode_transition_epoch: 0, root_mode_birth_token: "a".repeat(64),
    model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
    reasoning_effort: "medium", created_at: at, updated_at: at, last_activity_at: at,
    message_count: 0, has_attachments: false, is_running: false, last_run_status: "completed",
    permission_mode: "default", bypass_permissions: false,
  }))
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    if (path === "/api/v1/sessions") {
      const kind = url.searchParams.get("kind")
      const roots = sessions.filter((session) => !kind || session.kind === kind)
      return route.fulfill({ json: { sessions: roots, total: roots.length, limit: 200, offset: 0 } })
    }
    const selected = sessions.find((session) => path === `/api/v1/sessions/${session.id}`)
    if (selected) return route.fulfill({ json: { session: selected }, headers: { ETag: '"1"' } })
    const history = sessions.find((session) => path === `/api/v1/history/${session.id}`)
    if (history) return route.fulfill({ json: { session_id: history.id, messages: [] } })
    const actor = sessions.find((session) => path === `/api/v1/actors/${session.id}/snapshot`)
    if (actor) return route.fulfill({ json: actorSnapshotFixture(actor.id, 0) })
    if (sessions.some((session) => path === `/api/v1/task/${session.id}`)) return route.fulfill({ json: { items: [] } })
    if (sessions.some((session) => path === `/api/v1/respond/${session.id}/pending`)) return route.fulfill({ json: { has_pending_question: false } })
    return route.fallback()
  })
  await page.goto(standaloneScenario.entryUrl)
  await expect(page.getByRole("banner", { includeHidden: true })).toContainText("Command main")
  return observation
}

test("Command palette keeps IME candidates local, switches the current root and preserves drafts", async ({ page }, info) => {
  const observation = await setup(page)
  if (info.project.name === "phone-chromium") await page.keyboard.press("Escape")
  const composer = page.getByRole("textbox", { name: "消息", exact: true }).first()
  await composer.fill("Keep this main draft")
  await page.keyboard.press("Control+k")
  const search = page.getByPlaceholder("搜索会话或操作…")
  const dialog = page.getByRole("dialog", { name: "搜索会话或操作…", exact: true })
  await expect(search).toBeFocused()
  await expect(dialog.getByRole("option")).toHaveText(["新建对话", "系统设置", "Command main", "中文会话一", "中文会话二"])
  await search.evaluate((input) => input.dispatchEvent(new input.ownerDocument.defaultView!.CompositionEvent("compositionstart", { bubbles: true, data: "中" })))
  await search.fill("中文")
  await expect(dialog.getByRole("option")).toHaveText(["中文会话一", "中文会话二"])
  const selected = dialog.locator('[role="option"][aria-selected="true"]')
  await expect(selected).toHaveText("中文会话一")
  for (const key of ["ArrowDown", "Enter", "Escape"]) await search.press(key)
  await expect(search).toBeFocused()
  await expect(selected).toHaveText("中文会话一")
  await expect(page.getByRole("banner", { includeHidden: true })).toContainText("Command main")
  const screenshot = info.outputPath("command-palette-ime.png")
  await page.screenshot({ path: screenshot, animations: "disabled" })
  await info.attach("Command palette during composition", { path: screenshot, contentType: "image/png" })
  await search.evaluate((input) => {
    const browser = input.ownerDocument.defaultView!
    input.dispatchEvent(new browser.CompositionEvent("compositionend", { bubbles: true, data: "中文" }))
    input.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "Enter", keyCode: 229, bubbles: true, cancelable: true }))
  })
  await expect(search).toBeVisible()
  await search.press("ArrowDown")
  await expect(selected).toHaveText("中文会话二")
  await expect(search).toHaveAttribute("aria-activedescendant", await selected.getAttribute("id") ?? "")
  await search.press("Enter")
  await expect(search).toBeHidden()
  await expect(page.getByRole("banner")).toContainText("中文会话二")
  await page.keyboard.press("Control+k")
  await search.fill("Command main")
  await search.press("Enter")
  await expect(page.getByRole("banner")).toContainText("Command main")
  await expectComposerText(composer, "Keep this main draft")
  await page.keyboard.press("Control+k")
  await search.fill("中文会话一")
  const option = dialog.getByRole("option", { name: "中文会话一", exact: true })
  if (info.project.name === "desktop-chromium") await option.click()
  else await option.tap()
  await expect(page.getByRole("banner")).toContainText("中文会话一")
  expect(observation.pageErrors).toEqual([])
})

test("Command palette handles empty results and repeated Escape without stealing navigation focus", async ({ page }, info) => {
  const observation = await setup(page)
  if (info.project.name === "phone-chromium") await page.keyboard.press("Escape")
  const composer = page.getByRole("textbox", { name: "消息", exact: true }).first()
  await composer.fill("Keep the keyboard owner")
  const search = page.getByPlaceholder("搜索会话或操作…")
  for (let attempt = 0; attempt < 3; attempt++) {
    await composer.focus()
    await page.keyboard.press("Control+k")
    await expect(search).toBeFocused()
    await expect(search).toHaveValue("")
    await search.fill("no matching command")
    await expect(page.getByRole("dialog").getByRole("status")).toHaveText("无匹配")
    await search.press("Enter")
    await expect(search).toBeVisible()
    await search.press("Escape")
    await expect(search).toBeHidden()
    await expect(composer).toBeFocused()
  }
  await page.keyboard.press("Control+k")
  await search.fill("系统设置")
  await search.press("Enter")
  const settings = page.locator('[data-slot="settings-page"]')
  await expect(settings.getByRole("heading", { name: "系统设置", exact: true })).toBeFocused()
  await settings.getByRole("button", { name: "返回聊天", exact: true }).click()
  await expect(composer).toBeFocused()
  await expectComposerText(composer, "Keep the keyboard owner")
  expect(observation.pageErrors).toEqual([])
})
