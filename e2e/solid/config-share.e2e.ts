import { expect, test, type Locator, type Page } from "@playwright/test"
import type { ShareApplyRequest } from "../../src/shared/types/configShare"
import { installArtifactRuntime, standaloneScenario } from "../support/artifactRuntime.js"

const provider = "fixture-provider"
const source = "BAMBOO-SHARE:1:solid-config-share-fixture"
const exported = "BAMBOO-SHARE:1:solid-export-fixture"
const passphrase = "synthetic passphrase"
const backendMustNotDisplay = "synthetic-redaction-marker"
const expected = { providers: 3, env: 4, credentials: 5 }
const committed = { providers: 6, env: 7, credentials: 8 }
const chat = { provider, model: "fixture-model" }
const snapshot = {
  default_provider_instance_id: provider,
  instances: [{ id: provider, type: "openai", label: "Fixture provider", enabled: true, config: { model: chat.model } }],
  defaults: { chat },
}
const previewResponse = (mismatch = false) => ({
  apply_blocked: false, warnings: [],
  expected_revisions: expected, preview_token: "synthetic-cas-preview",
  preview: {
    contains_secrets: true,
    providers: [{
      id: provider, provider_type: mismatch ? "anthropic" : "openai", has_api_key: true,
      has_base_url: !mismatch, conflict: true, replace_allowed: !mismatch, retains_existing_api_key: true,
      target_origin: "https://current.example:9443",
      ...(!mismatch ? { source_origin: "https://imported.example:8443" } : {}),
      credential_origin_risk: !mismatch, api_key: backendMustNotDisplay,
    }],
    env: [{ name: "Token", has_value: true, secret: true, conflict: true, value: backendMustNotDisplay }],
    scenarios: [{ scenario: "chat", ...chat, conflict: true }],
    subagent_models: [],
  },
})
const healthResponse = () => ({
  providers: { status: "healthy", revision: committed.providers },
  application: {
    sections: {
      providers: { revision: committed.providers },
      env: { revision: committed.env },
      credentials: { revision: committed.credentials },
    },
    consumers: [{
      id: "provider-runtime", state: "in_sync",
      applied_dependencies: { providers: committed.providers, credentials: committed.credentials },
      credential_source: { status: "observed_inputs", revision: committed.credentials },
    }],
  },
})
const byButton = (view: Locator, name: string) => view.getByRole("button", { name, exact: true })

function selectTab(settings: Locator, mobile: boolean, id: "config-share" | "general") {
  return mobile
    ? settings.getByRole("combobox", { name: "System Settings", exact: true }).selectOption(id)
    : byButton(settings, id === "general" ? "General" : "Configuration sharing").click()
}

async function fixture(page: Page, baseURL: string | undefined) {
  const entryUrl = new URL("/", baseURL).href
  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_ui_locale_v1", "en-US")
  })
  const observed = await installArtifactRuntime(page, {
    ...standaloneScenario, origin: new URL(entryUrl).origin, entryUrl,
  }, [], { serveStaticFromLocalServer: true })
  await page.route("**/api/v1/bamboo/env-vars", (route) => route.fulfill({
    json: { revision: 4, entries: [{ name: "Token", has_value: true, secret: true, value: backendMustNotDisplay }] },
  }))
  return { entryUrl, observed }
}

async function openConfigurationShare(page: Page, entryUrl: string, mobile: boolean) {
  await page.goto(entryUrl)
  if (mobile) await page.getByRole("button", { name: "Menu", exact: true }).click()
  await page.getByRole("button", { name: "System Settings", exact: true }).click()
  const settings = page.locator('[data-slot="settings-page"]')
  await selectTab(settings, mobile, "config-share")
  const configShare = settings.getByRole("region", { name: "Configuration sharing", exact: true })
  await expect(configShare.getByLabel("Fixture provider (fixture-provider)", { exact: true })).toBeVisible()
  return { settings, configShare }
}

async function preparePreview(view: Locator, phrase?: string) {
  await view.getByLabel("Paste sharing string", { exact: true }).fill(source)
  if (phrase) await view.getByLabel("Import passphrase (if protected)", { exact: true }).fill(phrase)
  await byButton(view, "Preview import").click()
  const preview = view.getByRole("region", { name: "Preview import", exact: true })
  await expect(preview).toBeVisible()
  return preview
}

test("uses opt-in exports and preserves redacted origin warnings and conflict review", async ({ page, baseURL, isMobile }) => {
  const { entryUrl, observed } = await fixture(page, baseURL)
  const exports: unknown[] = []
  let mismatch = false
  await page.route("**/api/v1/bamboo/config/share/export", (route) => {
    exports.push(route.request().postDataJSON())
    return route.fulfill({ json: { share_string: exported } })
  })
  await page.route("**/api/v1/bamboo/config/share/preview", (route) => route.fulfill({ json: previewResponse(mismatch) }))
  const { configShare } = await openConfigurationShare(page, entryUrl, isMobile)
  const providerCheck = configShare.getByLabel("Fixture provider (fixture-provider)", { exact: true })
  const scenario = configShare.getByLabel("chat: fixture-provider / fixture-model", { exact: true })
  const key = configShare.getByLabel("Include API key", { exact: true })
  await scenario.check()
  await expect(providerCheck).toBeChecked()
  await expect(key).toBeDisabled()
  await expect(configShare.getByLabel("Include base URL", { exact: true })).not.toBeChecked()
  await byButton(configShare, "Generate sharing string").click()
  await expect(configShare.getByLabel("Sharing string", { exact: true })).toHaveValue(exported)
  expect(exports).toEqual([{
    selection: { providers: [provider], provider_base_urls: [], provider_api_keys: [], scenarios: ["chat"], subagent_models: [], env: {} },
    include_secrets: false,
  }])
  await byButton(configShare, "Cancel and clear sharing data").click()
  await expect(configShare.getByLabel("Sharing string", { exact: true })).toHaveCount(0)
  await expect(scenario).not.toBeChecked()

  await providerCheck.check()
  await configShare.getByLabel("Allow the selected API keys and environment values in this export", { exact: true }).check()
  await key.check()
  const exportPassphrase = configShare.getByLabel("Export passphrase (required for keys or values)", { exact: true })
  const generate = byButton(configShare, "Generate sharing string")
  await exportPassphrase.fill("短密码")
  await expect(generate).toBeDisabled()
  await exportPassphrase.fill(passphrase)
  await generate.click()
  await expect(configShare.getByLabel("Sharing string", { exact: true })).toHaveValue(exported)
  await expect(exportPassphrase).toHaveValue("")
  expect(exports[1]).toEqual({
    selection: { providers: [provider], provider_base_urls: [], provider_api_keys: [provider], scenarios: [], subagent_models: [], env: {} },
    include_secrets: true, passphrase,
  })
  await byButton(configShare, "Cancel and clear sharing data").click()

  const preview = await preparePreview(configShare)
  const action = preview.getByRole("combobox", { name: "Import action providers:fixture-provider", exact: true })
  const review = preview.getByLabel("I reviewed the entries and conflict choices", { exact: true })
  const save = byButton(preview, "Save imported settings")
  await expect(action).toHaveValue("skip")
  await expect(preview).toContainText("Imported origin: https://imported.example:8443")
  await expect(preview).toContainText("Current origin: https://current.example:9443")
  await expect(preview).not.toContainText(backendMustNotDisplay)
  await expect(preview).not.toContainText(source)
  await review.check()
  await action.selectOption("replace")
  await expect(review).not.toBeChecked()
  await expect(save).toBeDisabled()
  await expect(preview.getByRole("alert")).toContainText("Future requests to https://imported.example:8443")

  mismatch = true
  await byButton(configShare, "Cancel and clear sharing data").click()
  await preparePreview(configShare)
  await expect(action).toHaveValue("skip")
  await expect(action.locator('option[value="replace"]')).toHaveJSProperty("disabled", true)
  await action.selectOption("rename")
  await expect(preview).toContainText("Imported origin: Not included; provider default")
  await preview.getByLabel("New name providers:fixture-provider", { exact: true }).fill("renamed-provider")
  await expect(save).toBeDisabled()
  await review.check()
  await expect(save).toBeEnabled()
  expect(await preview.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  expect(observed.pageErrors).toEqual([])
})

test("checks only the original receipt and refreshes canonical authority without replaying an uncertain import", async ({ page, baseURL, isMobile }) => {
  const { entryUrl, observed } = await fixture(page, baseURL)
  const writes: ShareApplyRequest[] = []
  const reads: string[] = []
  const catalogRequests: string[] = []
  let goodHealth = false
  let exactReceipt = false
  page.on("request", (request) => {
    const { pathname } = new URL(request.url())
    if (writes.length > 0 && /[/](provider-catalog|copilot|auth)([/]|$)/.test(pathname)) catalogRequests.push(pathname)
  })
  await page.route("**/api/v1/bamboo/config/share/preview", (route) => route.fulfill({ json: previewResponse() }))
  await page.route("**/api/v1/bamboo/config/share/apply", (route) => {
    writes.push(route.request().postDataJSON())
    return route.fulfill({ status: 500, json: { message: backendMustNotDisplay } })
  })
  await page.route("**/api/v1/bamboo/config/share/operations/*", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1)
    reads.push(`receipt:${id}`)
    return route.fulfill({ json: {
      operation_id: exactReceipt ? id : "00000000-0000-4000-8000-000000000000",
      state: "committed", revisions: committed,
    } })
  })
  await page.route("**/api/v1/bamboo/config/live-health", (route) => {
    reads.push("health")
    return goodHealth
      ? route.fulfill({ json: healthResponse() })
      : route.fulfill({ status: 403, json: { message: backendMustNotDisplay } })
  })
  await page.route("**/api/v1/bamboo/settings/provider-instances", (route) => {
    if (writes.length > 0) reads.push("canonical")
    return route.fulfill({ json: snapshot })
  })
  const { configShare } = await openConfigurationShare(page, entryUrl, isMobile)
  const preview = await preparePreview(configShare, passphrase)
  await preview.getByLabel("I reviewed the entries and conflict choices", { exact: true }).check()
  const save = byButton(preview, "Save imported settings")
  await save.evaluate((element) => {
    const button = element as HTMLButtonElement
    button.click()
    button.click()
  })
  const check = byButton(configShare, "Check import result")
  await expect(configShare.getByRole("alert")).toContainText("The import result is unconfirmed")
  expect(writes).toHaveLength(1)
  const id = writes[0].operation_id
  expect(writes[0]).toEqual({
    share_string: source, passphrase, operation_id: id, expected_revisions: expected, preview_token: "synthetic-cas-preview",
    choices: { providers: { [provider]: { action: "skip" } }, scenarios: { chat: { action: "skip" } }, subagent_models: {}, env: { Token: { action: "skip" } } },
  })
  await expect(configShare.getByText(`Import receipt: ${id}`, { exact: true })).toBeVisible()
  await expect(configShare.getByLabel("Paste sharing string", { exact: true })).toHaveValue("")
  await expect(configShare.getByLabel("Import passphrase (if protected)", { exact: true })).toHaveValue("")
  await expect(byButton(configShare, "Cancel and clear sharing data")).toBeDisabled()
  await check.click()
  await expect(check).toBeEnabled()
  await expect(configShare.getByRole("alert")).toContainText("The import result is unconfirmed")
  expect(reads).toEqual([`receipt:${id}`])
  exactReceipt = true
  await check.click()
  const refresh = byButton(configShare, "Refresh saved settings")
  await expect(refresh).toBeEnabled()
  await expect(configShare.getByRole("alert")).toContainText("the client settings could not be refreshed")
  await expect(configShare.getByRole("status")).toContainText("Imported settings are saved")
  await expect(configShare).not.toContainText(backendMustNotDisplay)
  await byButton(configShare, "Cancel and clear sharing data").click()
  await expect(configShare.getByText(`Import receipt: ${id}`, { exact: true })).toBeVisible()
  goodHealth = true
  await refresh.click()
  await expect(refresh).toHaveCount(0)
  await expect(configShare.getByRole("alert")).toHaveCount(0)
  expect(reads).toEqual([`receipt:${id}`, `receipt:${id}`, "health", "health", "canonical"])
  expect(writes).toHaveLength(1)
  expect(catalogRequests).toEqual([])
  const browserStorage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))
  expect(browserStorage).not.toContain(source)
  expect(browserStorage).not.toContain(passphrase)
  expect(observed.pageErrors).toEqual([])
})

test("discards a departing preview and clears the draft when reopening configuration sharing", async ({ page, baseURL, isMobile }) => {
  const { entryUrl, observed } = await fixture(page, baseURL)
  let previewStarted = false
  let releasePreview!: () => void
  const delayedPreview = new Promise<void>((resolve) => { releasePreview = resolve })
  await page.route("**/api/v1/bamboo/config/share/preview", async (route) => {
    previewStarted = true
    await delayedPreview
    await route.fulfill({ json: previewResponse() }).catch(() => {})
  })
  const { settings, configShare } = await openConfigurationShare(page, entryUrl, isMobile)
  await configShare.getByLabel("Paste sharing string", { exact: true }).fill(source)
  await configShare.getByLabel("Import passphrase (if protected)", { exact: true }).fill(passphrase)
  await byButton(configShare, "Preview import").click()
  await expect.poll(() => previewStarted).toBe(true)
  try {
    await selectTab(settings, isMobile, "general")
    await expect(configShare).toHaveCount(0)
  } finally { releasePreview() }
  await selectTab(settings, isMobile, "config-share")
  await expect(configShare.getByLabel("Paste sharing string", { exact: true })).toHaveValue("")
  await expect(configShare.getByLabel("Import passphrase (if protected)", { exact: true })).toHaveValue("")
  await expect(configShare.getByRole("region", { name: "Preview import", exact: true })).toHaveCount(0)
  await expect(configShare.getByRole("alert")).toHaveCount(0)
  expect(observed.pageErrors).toEqual([])
})

test("adopts an in-flight committed import after its settings tab closes", async ({ page, baseURL, isMobile }) => {
  const { entryUrl, observed } = await fixture(page, baseURL)
  const requests: string[] = []
  let applyStarted = false
  let releaseApply!: () => void
  const delayedApply = new Promise<void>((resolve) => { releaseApply = resolve })
  await page.route("**/api/v1/bamboo/config/share/preview", (route) => route.fulfill({ json: previewResponse() }))
  await page.route("**/api/v1/bamboo/config/share/apply", async (route) => {
    requests.push("apply")
    const { operation_id } = route.request().postDataJSON() as ShareApplyRequest
    applyStarted = true
    await delayedApply
    return route.fulfill({ json: { operation_id, state: "committed", revisions: committed } })
  })
  await page.route("**/api/v1/bamboo/config/live-health", (route) => {
    requests.push("health")
    return route.fulfill({ json: healthResponse() })
  })
  await page.route("**/api/v1/bamboo/settings/provider-instances", (route) => {
    if (applyStarted) requests.push("canonical")
    return route.fulfill({ json: snapshot })
  })
  const { settings, configShare } = await openConfigurationShare(page, entryUrl, isMobile)
  const preview = await preparePreview(configShare, passphrase)
  await preview.getByLabel("I reviewed the entries and conflict choices", { exact: true }).check()
  await byButton(preview, "Save imported settings").click()
  await expect.poll(() => applyStarted).toBe(true)
  try {
    await selectTab(settings, isMobile, "general")
    await expect(configShare).toHaveCount(0)
    expect(requests).toEqual(["apply"])
  } finally { releaseApply() }
  await expect.poll(() => requests).toEqual(["apply", "health", "canonical"])
  expect(observed.pageErrors).toEqual([])
})

test("invalidates a stale preview and only retries reads to recover the current authority", async ({ page, baseURL, isMobile }) => {
  const { entryUrl, observed } = await fixture(page, baseURL)
  const requests: string[] = []
  let allowHealth = false
  await page.route("**/api/v1/bamboo/config/share/preview", (route) => route.fulfill({ json: previewResponse() }))
  await page.route("**/api/v1/bamboo/config/share/apply", (route) => {
    requests.push("apply")
    return route.fulfill({ status: 409, json: { message: backendMustNotDisplay } })
  })
  await page.route("**/api/v1/bamboo/config/live-health", (route) => {
    requests.push("health")
    return allowHealth
      ? route.fulfill({ json: healthResponse() })
      : route.fulfill({ status: 403, json: { message: backendMustNotDisplay } })
  })
  await page.route("**/api/v1/bamboo/settings/provider-instances", (route) => {
    if (requests.length > 0) requests.push("canonical")
    return route.fulfill({ json: snapshot })
  })
  const { configShare } = await openConfigurationShare(page, entryUrl, isMobile)
  const preview = await preparePreview(configShare, passphrase)
  await preview.getByLabel("I reviewed the entries and conflict choices", { exact: true }).check()
  await byButton(preview, "Save imported settings").click()
  const refresh = byButton(configShare, "Refresh current settings")
  await expect(refresh).toBeEnabled()
  await expect(preview).toHaveCount(0)
  await expect(byButton(configShare, "Check import result")).toHaveCount(0)
  const input = configShare.getByLabel("Paste sharing string", { exact: true })
  await expect(input).toHaveValue("")
  await expect(input).toBeDisabled()
  await expect(configShare.getByRole("alert")).toContainText("The import was not saved")
  await byButton(configShare, "Cancel and clear sharing data").click()
  await expect(refresh).toBeEnabled()
  allowHealth = true
  await refresh.click()
  await expect(configShare.getByRole("alert")).toContainText("Settings changed after this preview")
  await expect(configShare).not.toContainText(backendMustNotDisplay)
  await expect(input).toBeEnabled()
  expect(requests).toEqual(["apply", "health", "health", "canonical"])
  expect(observed.pageErrors).toEqual([])
})
