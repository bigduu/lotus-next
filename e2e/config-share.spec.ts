import { test, expect } from "@playwright/test"

test("selective export and redacted import fit desktop and narrow viewports (synthetic backend)", async ({ page }, testInfo) => {
  const errors: string[] = []
  const unexpectedRequests: string[] = []
  const writes: string[] = []
  const exported = "BAMBOO-SHARE:1:synthetic-browser-fixture"
  const source = "BAMBOO-SHARE:1:synthetic-import-origin-fixture"
  const mismatchSource = "BAMBOO-SHARE:1:synthetic-type-mismatch-fixture"
  let previewRequests = 0
  page.on("pageerror", (error) => errors.push(error.message))
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== "http://127.0.0.1:4188") { unexpectedRequests.push(url.origin); return route.abort() }
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/v2/")) {
      unexpectedRequests.push(url.pathname); return route.abort()
    }
    return route.continue()
  })
  await page.route("**/e2e/config-share.html", (route) => route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">import RefreshRuntime from "/@react-refresh";RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>(type)=>type;window.__vite_plugin_react_preamble_installed__=true;await import("/e2e/support/configShareHarness.tsx")</script></body></html>' }))
  await page.route("**/api/v1/bamboo/settings/provider-instances", (route) => route.fulfill({ json: {
    default_provider_instance_id: "sample", instances: [{ id: "sample", type: "openai", label: "Sample provider", enabled: true, config: { model: "sample-model", base_url: "https://current.example:9443/v1", api_key: "****...****" } }],
    defaults: { chat: { provider: "sample", model: "sample-model" }, fast: { provider: "sample", model: "sample-fast" }, subagent_models: { helper: { provider: "sample", model: "sample-model" } } },
  } }))
  await page.route("**/api/v1/bamboo/env-vars", (route) => route.fulfill({ json: { revision: 4, entries: [{ name: "SAMPLE_TOKEN", has_value: true, secret: true }] } }))
  await page.route("**/api/v1/bamboo/config/share/export", async (route) => {
    writes.push("export")
    expect(route.request().postDataJSON()).toEqual({ selection: { providers: ["sample"], provider_base_urls: [], provider_api_keys: [], scenarios: [], subagent_models: [], env: {} }, include_secrets: false })
    return route.fulfill({ json: { share_string: exported }, headers: { "Cache-Control": "no-store" } })
  })
  await page.route("**/api/v1/bamboo/config/share/preview", async (route) => {
    writes.push("preview")
    const mismatch = previewRequests++ > 0
    expect(route.request().postDataJSON()).toEqual({ share_string: mismatch ? mismatchSource : source })
    const provider = mismatch
      ? { id: "sample", provider_type: "anthropic", label: "Sample provider", has_api_key: false, has_base_url: false, conflict: true, replace_allowed: false, target_origin: "https://current.example:9443", retains_existing_api_key: true, credential_origin_risk: false }
      : { id: "sample", provider_type: "openai", label: "Sample provider", has_api_key: false, has_base_url: true, conflict: true, replace_allowed: true, source_origin: "https://imported.example:8443", target_origin: "https://current.example:9443", retains_existing_api_key: true, credential_origin_risk: true }
    return route.fulfill({ json: {
      apply_blocked: false, warnings: [],
      preview_token: "synthetic-token", expected_revisions: { providers: 3, env: 4, credentials: 5 },
      preview: { contains_secrets: false, providers: [provider], scenarios: [{ scenario: "chat", provider: "sample", model: "sample-model", conflict: true }], subagent_models: [], env: [] },
    }, headers: { "Cache-Control": "no-store" } })
  })

  await page.goto("/e2e/config-share.html")
  await expect(page.getByRole("heading", { name: "Configuration sharing", exact: true })).toBeVisible()
  await expect(page.getByRole("checkbox", { name: "Sample provider (sample)", exact: true })).toBeVisible()
  await expect(page.getByRole("checkbox", { name: "Allow the selected API keys and environment values in this export" })).not.toBeChecked()
  await page.getByRole("checkbox", { name: "Sample provider (sample)", exact: true }).check()
  await page.getByRole("button", { name: "Generate sharing string", exact: true }).click()
  await expect(page.getByRole("textbox", { name: "Sharing string", exact: true })).toHaveValue(exported)
  await page.getByRole("button", { name: "Cancel and clear sharing data", exact: true }).click()
  await expect(page.getByRole("textbox", { name: "Sharing string", exact: true })).toHaveCount(0)
  await page.getByRole("heading", { name: "Export selected settings", exact: true }).scrollIntoViewIfNeeded()
  const exportScreenshot = testInfo.outputPath(`config-share-export-${testInfo.project.name}.png`)
  await page.screenshot({ path: exportScreenshot, animations: "disabled" })
  await testInfo.attach(`config-share-export-${testInfo.project.name}`, { path: exportScreenshot, contentType: "image/png" })

  await page.getByRole("textbox", { name: "Paste sharing string", exact: true }).fill(source)
  await page.getByRole("button", { name: "Preview import", exact: true }).click()
  const preview = page.getByRole("region", { name: "Preview import", exact: true })
  await expect(preview).toBeVisible()
  await expect(preview.getByRole("combobox", { name: "Import action providers:sample", exact: true })).toHaveValue("skip")
  await expect(preview).toContainText("Imported origin: https://imported.example:8443")
  await expect(preview).toContainText("Current origin: https://current.example:9443")
  await expect(preview.getByRole("alert")).toHaveCount(0)
  await page.getByRole("checkbox", { name: "I reviewed the entries and conflict choices", exact: true }).check()
  await preview.getByRole("combobox", { name: "Import action providers:sample", exact: true }).selectOption("replace")
  await expect(page.getByRole("checkbox", { name: "I reviewed the entries and conflict choices", exact: true })).not.toBeChecked()
  await expect(preview.getByRole("alert")).toContainText("Future requests to https://imported.example:8443 may send retained credentials or request settings.")
  await expect(page.getByRole("button", { name: "Save imported settings", exact: true })).toBeDisabled()
  await expect(preview).not.toContainText(source)
  await preview.scrollIntoViewIfNeeded()
  const previewScreenshot = testInfo.outputPath(`config-share-preview-${testInfo.project.name}.png`)
  await page.screenshot({ path: previewScreenshot, animations: "disabled" })
  await testInfo.attach(`config-share-preview-${testInfo.project.name}`, { path: previewScreenshot, contentType: "image/png" })

  await page.getByRole("button", { name: "Cancel and clear sharing data", exact: true }).click()
  await page.getByRole("textbox", { name: "Paste sharing string", exact: true }).fill(mismatchSource)
  await page.getByRole("button", { name: "Preview import", exact: true }).click()
  await expect(preview).toContainText("Imported provider type: anthropic")
  await expect(preview).toContainText("Provider types differ. Skip this entry or import it with a new name.")
  const providerAction = preview.getByRole("combobox", { name: "Import action providers:sample", exact: true })
  await expect(providerAction).toHaveValue("skip")
  await expect(providerAction.locator('option[value="replace"]')).toHaveJSProperty("disabled", true)
  await page.getByRole("checkbox", { name: "I reviewed the entries and conflict choices", exact: true }).check()
  await expect(page.getByRole("button", { name: "Save imported settings", exact: true })).toBeEnabled()
  await providerAction.selectOption("rename")
  await expect(page.getByRole("checkbox", { name: "I reviewed the entries and conflict choices", exact: true })).not.toBeChecked()
  await expect(preview).toContainText("Imported origin: Not included; provider default")
  await page.getByRole("textbox", { name: "New name providers:sample", exact: true }).fill("anthropic-shared")
  await expect(page.getByRole("button", { name: "Save imported settings", exact: true })).toBeDisabled()
  await page.getByRole("checkbox", { name: "I reviewed the entries and conflict choices", exact: true }).check()
  await expect(page.getByRole("button", { name: "Save imported settings", exact: true })).toBeEnabled()
  await expect(preview.getByRole("alert")).toHaveCount(0)
  await preview.scrollIntoViewIfNeeded()
  const typeScreenshot = testInfo.outputPath(`config-share-type-mismatch-${testInfo.project.name}.png`)
  await page.screenshot({ path: typeScreenshot, animations: "disabled" })
  await testInfo.attach(`config-share-type-mismatch-${testInfo.project.name}`, { path: typeScreenshot, contentType: "image/png" })
  expect(await page.evaluate(() => {
    const browser = globalThis as unknown as { document: { documentElement: { scrollWidth: number } }; innerWidth: number }
    return browser.document.documentElement.scrollWidth <= browser.innerWidth + 1
  })).toBe(true)
  const previewOverflow = await preview.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)
  expect(previewOverflow).toBe(true)
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(source)
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(mismatchSource)
  expect(writes).toEqual(["export", "preview", "preview"])
  expect(unexpectedRequests).toEqual([])
  expect(errors).toEqual([])
})
