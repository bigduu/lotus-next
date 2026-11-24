import { expect, test, type Locator, type Page } from "@playwright/test"
import type {
  ClusterUpsertRequest, FabricCluster, FabricNode, NodeUpsertRequest,
} from "../../src/services/config/SettingsService"
import { installArtifactRuntime, standaloneScenario } from "../support/artifactRuntime.js"

const remoteId = "remote-node"
const mask = "****...****"
const backendSecretMarker = "unexpected-synthetic-credential"
const fingerprint = "SHA256:synthetic-fixture-host"
const artifactChecksum = "a".repeat(64)

function worker(): FabricNode {
  return {
    id: remoteId, label: "Remote fixture", enabled: true, trust_level: "trusted",
    placement: {
      type: "ssh", host: "worker.example.test", port: 2222, username: "fixture",
      auth: { method: "password", password: backendSecretMarker }, host_key_fingerprint: fingerprint,
    },
    deploy: { artifact_path: "/fixture/bamboo", artifact_sha256: artifactChecksum, auto_recover: true },
    state: { status: "running" },
  }
}

type RequestEntry = { method: string; path: string; body?: unknown }
const button = (view: Locator, name: string) => view.getByRole("button", { name, exact: true })
const settingsRoot = (page: Page) => page.locator('[data-slot="settings-page"]')
const nodeSection = (page: Page) => settingsRoot(page).getByRole("region", { name: "Nodes", exact: true })
const clusterSection = (page: Page) => settingsRoot(page).getByRole("region", { name: "Clusters", exact: true }).last()
const nodeRow = (page: Page, label: string) => nodeSection(page).getByRole("listitem").filter({ hasText: label })

async function installFixture(page: Page, baseURL: string | undefined) {
  const entryUrl = new URL("/", baseURL).href
  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_ui_locale_v1", "en-US")
    localStorage.setItem("lotus_experience_mode_v1", "advanced")
  })
  const observed = await installArtifactRuntime(page, {
    ...standaloneScenario, origin: new URL(entryUrl).origin, entryUrl,
  }, [], { serveStaticFromLocalServer: true })
  const nodes: FabricNode[] = [worker()]
  const clusters: FabricCluster[] = []
  const requests: RequestEntry[] = []
  let refuseMembership = false
  await page.route(/[/]api[/]v1[/]bamboo[/]settings[/](nodes|clusters)(?:[/][^/?]+)?$/, (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.split("/").slice(5).join("/")
    const method = request.method()
    const body = request.postDataJSON()
    requests.push({ method, path, ...(body ? { body } : {}) })
    if (method === "GET" && path === "nodes") return route.fulfill({ json: { nodes, clusters } })
    if (method === "POST" && path === "nodes") {
      const created = { ...(body as NodeUpsertRequest), id: "local-test-node", state: { status: "not_deployed" } } as FabricNode
      nodes.push(created)
      return route.fulfill({ json: created })
    }
    if (method === "PUT" && path === `nodes/${remoteId}`) {
      nodes[0] = { ...nodes[0], ...(body as NodeUpsertRequest) }
      return route.fulfill({ json: nodes[0] })
    }
    if (method === "DELETE" && path === "nodes/local-test-node") {
      const index = nodes.findIndex((node) => node.id === "local-test-node")
      if (index !== -1) nodes.splice(index, 1)
      return route.fulfill({ status: 204 })
    }
    if (method === "POST" && path === "clusters") {
      clusters.push(body as ClusterUpsertRequest)
      return route.fulfill({ json: { clusters } })
    }
    if (method === "PUT" && path === "clusters/fixture-pool") {
      if (refuseMembership) return route.fulfill({ status: 409, json: { message: "Synthetic membership conflict" } })
      clusters[0] = body as ClusterUpsertRequest
      return route.fulfill({ json: { clusters } })
    }
    if (method === "DELETE" && path === "clusters/fixture-pool") {
      clusters.splice(0)
      return route.fulfill({ json: { clusters } })
    }
    return route.fulfill({ status: 418, json: { message: `Unexpected fixture request ${method} ${path}` } })
  })
  return { entryUrl, nodes, requests, observed, refuseMembership: (value: boolean) => { refuseMembership = value } }
}

async function openClusters(page: Page, entryUrl: string, mobile: boolean) {
  await page.goto(entryUrl)
  if (mobile) await button(page.locator("body"), "Menu").click()
  await button(page.locator("body"), "System Settings").click()
  const settings = settingsRoot(page)
  if (mobile) await settings.getByRole("combobox", { name: "System Settings", exact: true }).selectOption("clusters")
  else await button(settings, "Clusters").click()
  await expect(nodeRow(page, "Remote fixture")).toBeVisible()
  return settings
}

async function select(dialog: Locator, label: string, value: string) {
  await dialog.locator(`[data-slot="select-trigger"][aria-label="${label}"]`).click()
  await dialog.getByRole("option", { name: value, exact: true }).click()
}

test("creates a local node, preserves a remote credential only as a mask, and confirms deletion", async ({ page, baseURL, isMobile }) => {
  const fixture = await installFixture(page, baseURL)
  const settings = await openClusters(page, fixture.entryUrl, isMobile)
  await button(nodeSection(page), "Add node").click()
  const create = page.getByRole("dialog", { name: "Add node", exact: true })
  await create.getByLabel("Name", { exact: true }).fill("Local fixture")
  await select(create, "Deployment location", "Local")
  await expect(create.getByLabel("Host", { exact: true })).toHaveCount(0)
  await button(create, "Save").click()
  const local = nodeRow(page, "Local fixture")
  await expect(local).toBeVisible()
  expect(fixture.requests.find((request) => request.method === "POST")).toMatchObject({
    path: "nodes", body: { label: "Local fixture", placement: { type: "local" }, trust_level: "trusted", enabled: true },
  })

  const remote = nodeRow(page, "Remote fixture")
  await button(remote, "Edit node").click()
  const edit = page.getByRole("dialog", { name: "Edit node", exact: true })
  const password = edit.getByLabel("Password", { exact: true }).and(edit.locator('input[type="password"]'))
  await expect(password).toHaveValue("")
  await expect(password).toHaveAttribute("type", "password")
  await expect(edit).not.toContainText(backendSecretMarker)
  await edit.getByLabel("Port", { exact: true }).fill("65536")
  await button(edit, "Save").click()
  await expect(edit.getByRole("alert")).toContainText("Port must be between 1 and 65535")
  expect(fixture.requests.filter((request) => request.method === "PUT")).toHaveLength(0)
  await edit.getByLabel("Port", { exact: true }).fill("2222")
  await edit.getByLabel("Name", { exact: true }).fill("Remote fixture updated")
  await button(edit, "Save").click()
  await expect(edit).toBeHidden()
  await expect(nodeRow(page, "Remote fixture updated")).toBeVisible()
  const writes = () => fixture.requests.filter((request) => request.method === "PUT")
  expect(writes()[0]).toMatchObject({
    path: `nodes/${remoteId}`, body: {
      label: "Remote fixture updated", placement: { auth: { method: "password", password: mask }, host_key_fingerprint: fingerprint },
      deploy: { artifact_sha256: artifactChecksum, auto_recover: true },
    },
  })
  await button(remote, "Edit node").click()
  await select(edit, "Authentication", "Use local SSH configuration")
  await expect(password).toHaveCount(0)
  await button(edit, "Save").click()
  await expect(edit).toBeHidden()
  expect((writes()[1].body as NodeUpsertRequest).placement).toEqual({
    type: "ssh", host: "worker.example.test", port: 2222, username: "fixture",
    auth: { method: "system_ssh_config" }, host_key_fingerprint: fingerprint,
  })
  await remote.getByRole("switch", { name: "Disable node", exact: true }).press("Space")
  await expect(remote.getByRole("switch", { name: "Enable node", exact: true })).toBeVisible()
  expect(writes()[2]).toMatchObject({ body: { enabled: false, placement: { auth: { method: "system_ssh_config" } } } })

  await button(local, "Delete node").click()
  await expect(local).toContainText("Confirm deletion?")
  expect(fixture.requests.filter((request) => request.method === "DELETE")).toHaveLength(0)
  await button(local, "Cancel").click()
  await button(local, "Delete node").click()
  await button(local, "Delete").click()
  await expect(local).toHaveCount(0)
  expect(fixture.requests.filter((request) => request.method === "DELETE")).toEqual([{ method: "DELETE", path: "nodes/local-test-node" }])
  await expect(settings).not.toContainText(backendSecretMarker)
  expect(fixture.observed.pageErrors).toEqual([])
})

test("round-trips cluster membership and removes the cluster without removing its node", async ({ page, baseURL, isMobile }) => {
  const fixture = await installFixture(page, baseURL)
  await openClusters(page, fixture.entryUrl, isMobile)
  const clusters = clusterSection(page)
  await button(clusters, "Add cluster").click()
  const create = page.getByRole("dialog", { name: "Add cluster", exact: true })
  await create.getByLabel("Name", { exact: true }).fill("fixture-pool")
  await create.getByLabel("Description (optional)", { exact: true }).fill("Synthetic deployment group")
  const member = (dialog: Locator) => dialog.getByRole("button", { name: /Remote fixture/ })
  await member(create).click()
  await expect(member(create)).toHaveAttribute("aria-pressed", "true")
  await button(create, "Save").click()
  const cluster = clusters.getByRole("listitem").filter({ hasText: "fixture-pool" })
  await expect(cluster).toContainText("1 node · Remote fixture")
  await expect(nodeRow(page, "Remote fixture")).toContainText("fixture-pool")
  expect(fixture.requests.find((entry) => entry.method === "POST")).toEqual({
    method: "POST", path: "clusters", body: { name: "fixture-pool", description: "Synthetic deployment group", node_ids: [remoteId] },
  })

  fixture.refuseMembership(true)
  await button(cluster, "Edit cluster").click()
  const edit = page.getByRole("dialog", { name: "Edit cluster", exact: true })
  await expect(edit.getByLabel("Name", { exact: true })).toBeDisabled()
  await member(edit).click()
  await button(edit, "Save").click()
  await expect(edit.getByRole("alert")).toContainText("membership changes did not take effect")
  await expect(member(edit)).toHaveAttribute("aria-pressed", "false")
  fixture.refuseMembership(false)
  await button(edit, "Save").click()
  await expect(cluster).toContainText("0 nodes")
  expect(fixture.requests.filter((entry) => entry.method === "PUT")).toEqual([
    { method: "PUT", path: "clusters/fixture-pool", body: { name: "fixture-pool", description: "Synthetic deployment group", node_ids: [] } },
    { method: "PUT", path: "clusters/fixture-pool", body: { name: "fixture-pool", description: "Synthetic deployment group", node_ids: [] } },
  ])

  await button(cluster, "Edit cluster").click()
  await member(edit).click()
  await button(edit, "Save").click()
  await expect(cluster).toContainText("1 node")
  await button(cluster, "Delete cluster").click()
  await expect(cluster).toContainText("Confirm deletion?")
  await button(cluster, "Delete").click()
  await expect(cluster).toHaveCount(0)
  await expect(nodeRow(page, "Remote fixture")).toBeVisible()
  expect(fixture.requests.filter((entry) => entry.method === "DELETE")).toEqual([{ method: "DELETE", path: "clusters/fixture-pool" }])
  expect(fixture.observed.pageErrors).toEqual([])
})

test("refreshes exact lifecycle state, tails logs, and suspends health polling while a dialog is open", async ({ page, baseURL, isMobile }) => {
  const fixture = await installFixture(page, baseURL)
  const actions: Array<{ action: string; body: unknown }> = []
  const logReads: string[] = []
  await page.route(new RegExp(`/bamboo/settings/nodes/${remoteId}/(test|deploy|stop)$`), (route) => {
    const action = new URL(route.request().url()).pathname.split("/").at(-1)!
    actions.push({ action, body: route.request().postDataJSON() })
    fixture.nodes[0].state = { status: action === "deploy" ? "deploying" : action === "stop" ? "stopped" : "running" }
    return route.fulfill({ json: { ...(action === "test" ? { preflight: "synthetic preflight" } : {}) } })
  })
  await page.route(`**/api/v1/bamboo/settings/nodes/${remoteId}/logs?*`, (route) => {
    logReads.push(new URL(route.request().url()).search)
    return route.fulfill({ json: { id: remoteId, logs: `Synthetic worker log ${logReads.length}` } })
  })

  const settings = await openClusters(page, fixture.entryUrl, isMobile)
  const remote = nodeRow(page, "Remote fixture")
  await button(remote, "Test").click()
  await expect(settings.getByRole("status")).toContainText("Connected: synthetic preflight")
  await button(remote, "Deploy").click()
  await expect(remote).toContainText("Deploying")
  await button(remote, "Stop").click()
  await expect(remote).toContainText("Stopped")
  expect(actions).toEqual(["test", "deploy", "stop"].map((action) => ({ action, body: {} })))

  await button(remote, "Logs").click()
  const logs = page.getByRole("dialog", { name: "Logs — Remote fixture", exact: true })
  await expect(logs.getByText("Synthetic worker log 1", { exact: true })).toBeVisible()
  await button(logs, "Refresh").click()
  await expect(logs.getByText("Synthetic worker log 2", { exact: true })).toBeVisible()
  const readCount = fixture.requests.length
  fixture.nodes[0].state = { status: "unreachable", last_error: "Synthetic worker disconnected" }
  const visibility = () => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))
  await visibility()
  expect(fixture.requests).toHaveLength(readCount)
  await logs.getByRole("button", { name: "Close", exact: true }).last().click()
  await expect(logs).toBeHidden()
  await visibility()
  await expect(remote).toContainText("Unreachable")
  await expect(remote).toContainText("Synthetic worker disconnected")
  expect(logReads).toEqual(["?lines=200", "?lines=200"])
  expect(fixture.observed.pageErrors).toEqual([])
})

test("keeps existing private-key secrets masked and clears unsaved replacement credentials", async ({ page, baseURL, isMobile }) => {
  const fixture = await installFixture(page, baseURL)
  const placement = fixture.nodes[0].placement
  if (placement.type !== "ssh") throw new Error("Expected an SSH fixture")
  placement.auth = {
    method: "private_key", private_key: backendSecretMarker, private_key_path: "/fixture/identity",
    passphrase: "synthetic-backend-passphrase",
  }
  await openClusters(page, fixture.entryUrl, isMobile)
  const remote = nodeRow(page, "Remote fixture")
  await button(remote, "Edit node").click()
  const edit = page.getByRole("dialog", { name: "Edit node", exact: true })
  const key = edit.getByLabel("…or paste a private key (PEM)", { exact: true })
  const passphrase = edit.getByLabel("Private key passphrase (optional)", { exact: true })
  await expect(key).toHaveValue("")
  await expect(passphrase).toHaveValue("")
  await expect(edit.getByLabel("Private key file path (local)", { exact: true })).toHaveValue("/fixture/identity")
  await button(edit, "Save").click()
  await expect(edit).toBeHidden()
  const writes = () => fixture.requests.filter((entry) => entry.method === "PUT")
  expect((writes()[0].body as NodeUpsertRequest).placement).toEqual({
    type: "ssh", host: "worker.example.test", port: 2222, username: "fixture",
    auth: { method: "private_key", private_key: mask, private_key_path: "/fixture/identity", passphrase: mask },
    host_key_fingerprint: fingerprint,
  })

  await button(remote, "Edit node").click()
  await select(edit, "Authentication", "Password")
  await button(edit, "Save").click()
  await expect(edit.getByRole("alert")).toContainText("Password is required")
  expect(writes()).toHaveLength(1)
  await edit.locator('input[type="password"]').fill("synthetic-unsaved-password")
  await button(edit, "Cancel").click()
  await expect(edit).toBeHidden()
  await button(remote, "Edit node").click()
  await expect(key).toHaveValue("")
  await expect(passphrase).toHaveValue("")
  await expect(edit).not.toContainText("synthetic-unsaved-password")
  expect(writes()).toHaveLength(1)
  expect(fixture.observed.pageErrors).toEqual([])
})
