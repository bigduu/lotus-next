import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "../support/artifactRuntime.js"
import { selectSettingsCategory, settingsSurface } from "../support/settingsNavigation.js"

const server = (id: string, ready = false) => ({
  id, name: id, enabled: ready,
  config: { id, transport: { type: "stdio", command: "fixture-only", args: [], env: {} } },
  runtime: { status: ready ? "ready" : "stopped", tool_count: ready ? 1 : 0 },
})
const syntheticValue = "SYNTHETIC_MCP_IMPORT_VALUE"
const configuration = {
  mcpServers: { incoming: { command: "fixture-only", disabled: true, env: { DEMO: syntheticValue } } },
}

test("MCP replacement rechecks the inventory and confirms only the reviewed configuration", async ({ page, baseURL, isMobile }) => {
  const entryUrl = new URL("/", baseURL).href
  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_ui_locale_v1", "zh-CN")
  })
  const observed = await installArtifactRuntime(page, {
    ...standaloneScenario, entryUrl, origin: new URL(entryUrl).origin,
  }, [], { serveStaticFromLocalServer: true })
  const writes: unknown[] = []
  let inventory = [server("existing")]
  await page.route("**/api/v1/mcp/servers", (route) => route.fulfill({ json: { servers: inventory } }))
  await page.route("**/api/v1/mcp/servers/import", (route) => {
    expect(route.request().method()).toBe("POST")
    writes.push(route.request().postDataJSON())
    inventory = [server("incoming", true)]
    return route.fulfill({ json: { mode: "replace", added: 1, updated: 0, removed: 2, server_ids: ["incoming"] } })
  })

  await page.goto(entryUrl)
  if (isMobile) await page.getByRole("button", { name: "菜单", exact: true }).click()
  await page.getByRole("button", { name: "系统设置", exact: true }).click()
  const settings = settingsSurface(page)
  await selectSettingsCategory(settings, "mcp", "MCP")
  const trigger = settings.getByRole("button", { name: "导入 JSON", exact: true })
  const dialog = page.getByRole("dialog", { name: "导入 MCP JSON", exact: true })
  const draft = dialog.getByRole("textbox", { name: "MCP JSON 配置", exact: true })
  const submit = dialog.getByRole("button", { name: "导入", exact: true })

  const enable = settings.getByRole("switch", { name: "启用", exact: true })
  await expect(enable).toBeVisible()
  await expect(enable).not.toBeChecked()
  await trigger.click()
  const cancel = dialog.getByRole("button", { name: "取消", exact: true })
  await expect(cancel).toBeFocused()
  await expect(submit).toBeDisabled()
  await draft.fill(JSON.stringify(configuration))
  await cancel.press("Escape")
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
  await trigger.click()
  await expect(draft).toHaveValue("")
  expect(writes).toEqual([])

  await draft.fill(JSON.stringify(configuration))
  const preview = dialog.getByRole("region", { name: "导入预览", exact: true })
  await expect(preview).toContainText("incoming")
  await expect(preview).not.toContainText(syntheticValue)
  await dialog.getByRole("radio", { name: "Replace（替换全部）", exact: true }).check()
  const confirmation = dialog.getByRole("checkbox")
  await expect(submit).toBeDisabled()
  await confirmation.check()
  inventory = [server("existing"), server("newly-discovered")]
  await submit.click()
  await expect(dialog.getByRole("alert")).toContainText("列表已变化")
  await expect(dialog.getByRole("list", { name: "将删除的服务器", exact: true })).toContainText("newly-discovered")
  await expect(confirmation).not.toBeChecked()
  await expect(submit).toBeDisabled()
  expect(writes).toEqual([])

  await confirmation.check()
  await submit.click()
  const result = dialog.getByRole("status", { name: "导入结果", exact: true })
  await expect(result).toContainText("删除 2")
  await expect(result).toContainText("实际服务器列表与运行状态已刷新")
  expect(writes).toEqual([{ ...configuration, mode: "replace" }])
  await dialog.getByRole("button", { name: "完成", exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(settings.getByText("incoming", { exact: true })).toBeVisible()
  await expect(settings.getByText("newly-discovered", { exact: true })).toHaveCount(0)
  await expect(settings.getByText("已连接 · 1 工具", { exact: true })).toBeVisible()
  expect(observed.pageErrors).toEqual([])
})
