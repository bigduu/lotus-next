import { expect, test, type Page } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"
import { NOVA_PLUGIN } from "../src/components/chat/settings/plugins/officialPlugins.js"

// Built-artifact browser acceptance with fixture APIs. This does not certify
// package downloads, native Nova.app installation or OS permission readiness.
const nova = {
  id: "nova", name: "Nova Desktop Automation", version: "0.3.0", status: "installed",
  source: NOVA_PLUGIN.source, registered: { mcp_server_ids: ["nova"], skill_dirs: ["nova-grounding"] },
}
const openPlugins = async (page: Page) => {
  const settings = page.getByRole("button", { name: "系统设置", exact: true })
  const bounds = await settings.boundingBox()
  if (!bounds || bounds.x < 0 || bounds.x + bounds.width > (page.viewportSize()?.width ?? Infinity)) {
    await page.getByRole("button", { name: "菜单", exact: true }).click()
  }
  await settings.click()
  const categories = page.locator("#settings-category")
  await categories.waitFor({ state: "attached" })
  if (await categories.isVisible()) await categories.selectOption("plugins")
  else await page.getByRole("button", { name: "插件", exact: true }).click()
}

test("official discovery, retry and installed connection management fit the viewport", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_ui_locale_v1", "zh-CN")
    localStorage.setItem("copilot_ui_theme_v1", "light")
  })
  const observation = await installArtifactRuntime(page, standaloneScenario)
  let installed = false
  let enabled = false
  let attempts = 0
  const installs: unknown[] = []
  await page.route("**/api/v1/plugins**", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { plugins: installed ? [nova] : [] } })
    installs.push(route.request().postDataJSON())
    attempts += 1
    if (attempts === 1) return route.fulfill({ status: 422, json: { error: "Fixture installation rejected" } })
    installed = true
    return route.fulfill({ json: nova })
  })
  await page.route("**/api/v1/mcp/servers**", async (route) => {
    if (route.request().method() === "POST") {
      enabled = new URL(route.request().url()).pathname.endsWith("/connect")
      return route.fulfill({ json: { server_id: "nova" } })
    }
    return route.fulfill({ json: { servers: installed ? [{
      id: "nova", name: "Nova Desktop Automation", enabled,
      config: { id: "nova", enabled, transport: { type: "stdio", command: "/fixture/nova", args: ["mcp"], env: {} } },
      runtime: { status: enabled ? "ready" : "stopped", tool_count: enabled ? 3 : 0 },
    }] : [] } })
  })
  await page.goto(standaloneScenario.entryUrl)
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible()
  await openPlugins(page)
  const novaCard = page.getByRole("article", { name: "Nova", exact: true })
  await expect(novaCard.getByRole("button", { name: "安装 Nova 插件" })).toBeEnabled()
  await expect(novaCard).toContainText("另外安装并运行 Nova.app")
  const jianduCard = page.getByRole("article", { name: "Jiandu", exact: true })
  await expect(jianduCard).toContainText("基础记忆已内置")
  await expect(jianduCard.getByRole("button")).toBeDisabled()
  await testInfo.attach(`plugin-discover-${testInfo.project.name}`, { body: await page.screenshot({ animations: "disabled" }), contentType: "image/png" })

  await novaCard.getByRole("button", { name: "安装 Nova 插件" }).click()
  await expect(page.getByRole("alert")).toContainText("可再次安装")
  await novaCard.getByRole("button", { name: "安装 Nova 插件" }).click()
  await expect(novaCard.getByRole("button", { name: "管理已安装插件" })).toBeEnabled()
  expect(installs).toEqual([{ source: NOVA_PLUGIN.source }, { source: NOVA_PLUGIN.source }])
  await novaCard.getByRole("button", { name: "管理已安装插件" }).click()
  const installedCard = page.getByRole("listitem", { name: "Nova Desktop Automation", exact: true })
  const toggle = installedCard.getByRole("switch")
  await expect(toggle).not.toBeChecked()
  await toggle.click()
  await expect(toggle).toBeChecked()
  await expect(installedCard).toContainText("已连接")
  await expect(installedCard).toContainText("尚未验证桌面权限")
  await expect(installedCard).toContainText("此页面无法检查这些权限")
  await expect(page.getByRole("button", { name: "高级安装", exact: true })).toBeEnabled()
  expect(await page.evaluate(() => {
    const browser = globalThis as unknown as { document: { documentElement: { scrollWidth: number } }; innerWidth: number }
    return browser.document.documentElement.scrollWidth <= browser.innerWidth + 1
  })).toBe(true)
  await testInfo.attach(`plugin-installed-${testInfo.project.name}`, { body: await page.screenshot({ animations: "disabled" }), contentType: "image/png" })
  expect(observation.pageErrors).toEqual([])
})
