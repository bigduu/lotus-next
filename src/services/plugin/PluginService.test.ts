import { beforeEach, describe, expect, it, vi } from "vitest"
import { apiClient, ApiError } from "@services/api"
import { PluginService, novaInstallReason } from "./PluginService"
import type { JianduSetupReport, NovaAppSetupReport } from "./types"

const service = new PluginService()
const report = (ready = false): JianduSetupReport => ({
  plugin_id: "jiandu", host: { os: "linux", arch: "x86_64", libc: "2.35", supported: true, reason: null },
  release: { version: "0.3.2", manifest_url: "https://fixture.invalid/jiandu.tar.gz", sha256: "a".repeat(64) },
  trust: { trusted: true, reason: null }, install: { available: !ready, reason: ready ? "already_installed" : null },
  installed: { state: ready ? "ready" : "missing", version: ready ? "0.3.2" : null, reason: null },
  external_client: ready ? { command: "/plugins/jiandu/bin/linux/jiandu", args: ["--data-dir", "/custom/active memory"] } : null,
})
const get = vi.fn()
beforeEach(() => { get.mockReset(); vi.spyOn(apiClient, "get").mockImplementation(get) })

describe("Jiandu setup authority", () => {
  it.each([false, true])("accepts the complete host report (ready=%s) without browser platform inference", async (ready) => {
    const value = report(ready)
    get.mockResolvedValue(value)
    expect(await service.getJianduSetup()).toEqual(value)
    expect(get).toHaveBeenCalledExactlyOnceWith("plugins/jiandu/setup")
  })
  it("accepts absolute Windows paths from a Windows Bamboo host", async () => {
    const value = report(true)
    value.host.os = "windows"
    value.external_client = { command: "C:\\Bamboo\\jiandu.exe", args: ["--data-dir", "\\\\host\\share\\memory"] }
    get.mockResolvedValue(value)
    expect(await service.getJianduSetup()).toEqual(value)
  })
  it("exports only command and args to the external MCP client", async () => {
    const value = report(true)
    get.mockResolvedValue({ ...value, external_client: { ...value.external_client, env: { EXTRA: "unreviewed" }, url: "https://fixture.invalid" } })
    expect((await service.getJianduSetup()).external_client).toEqual(value.external_client)
  })
  it.each([
    ["missing report", () => null],
    ["wrong plugin", (value) => ({ ...value, plugin_id: "nova" })],
    ["missing host", (value) => ({ ...value, host: undefined })],
    ["missing trust", (value) => ({ ...value, trust: undefined })],
    ["unknown state", (value) => ({ ...value, installed: { ...value.installed, state: "installed" } })],
    ["invalid checksum", (value) => ({ ...value, release: { ...value.release, sha256: "unknown" } })],
    ["unsupported install", (value) => ({ ...value, host: { ...value.host, supported: false } })],
    ["untrusted install", (value) => ({ ...value, trust: { ...value.trust, trusted: false } })],
    ["unpublished install", (value) => ({ ...value, release: null })],
  ] satisfies [string, (value: JianduSetupReport) => unknown][])("rejects %s instead of authorizing installation", async (_name, alter) => {
    get.mockResolvedValue(alter(report()))
    await expect(service.getJianduSetup()).rejects.toThrow("could not be verified")
  })
  it.each([
    ["missing client", (value) => ({ ...value, external_client: null })],
    ["relative command", (value) => ({ ...value, external_client: { ...value.external_client, command: "jiandu" } })],
    ["relative root", (value) => ({ ...value, external_client: { ...value.external_client, args: ["--data-dir", "memory"] } })],
    ["extra CLI arguments", (value) => ({ ...value, external_client: { ...value.external_client, args: ["--data-dir", "/memory", "--unknown"] } })],
    ["wrong CLI argument", (value) => ({ ...value, external_client: { ...value.external_client, args: ["--project", "/memory"] } })],
    ["unverified client", (value) => ({ ...value, installed: { ...value.installed, state: "unverified" } })],
    ["installing client", (value) => ({ ...value, installed: { ...value.installed, state: "installing" } })],
    ["mismatched version", (value) => ({ ...value, installed: { ...value.installed, version: "0.3.1" } })],
    ["untrusted ready state", (value) => ({ ...value, trust: { ...value.trust, trusted: false } })],
  ] satisfies [string, (value: JianduSetupReport) => unknown][])("rejects %s instead of exporting client paths", async (_name, alter) => {
    get.mockResolvedValue(alter(report(true)))
    await expect(service.getJianduSetup()).rejects.toThrow("could not be verified")
  })
  it("preserves the legacy API error and uses only the source-fixed empty-body install action", async () => {
    get.mockRejectedValue(new ApiError("Not Found", 404, "Not Found"))
    await expect(service.getJianduSetup()).rejects.toMatchObject({ status: 404 })
    const post = vi.spyOn(apiClient, "post").mockResolvedValue({ id: "jiandu", status: "installed" })
    await expect(service.installOfficialJiandu()).resolves.toBeUndefined()
    expect(post).toHaveBeenCalledExactlyOnceWith("plugins/official/jiandu/install", {})
  })
})

const novaReport = (installed = false): NovaAppSetupReport => ({
  plugin_id: "nova", host: { os: "macos", arch: "aarch64", supported: true, reason: null },
  connector: { state: "verified", version: "0.3.1", reason: null }, capability: { supported: true, reason: null },
  app: installed ? { success: true, state: "installed", message: "Verified app", next_action: "Open and grant permissions",
    path: "/Applications/Nova.app", version: "0.3.1", signing: "ad_hoc", development: true, connector_compatible: true }
    : { success: true, state: "missing", message: "No app", next_action: "Explicit installation" },
  install: { available: !installed, reason: installed ? "app_not_missing" : null },
  artifact: { artifact_id: "fixture-reviewed-app", version: "0.3.1", url: "https://fixture.invalid/app.zip", sha256: "a".repeat(64), signing: "ad_hoc", install_mode: "local_ad_hoc", development: true },
  manual_guidance: "Open the app and grant permissions manually", desktop_server_id: "nova", desktop_readiness: "not_tested",
})
describe("Nova app setup authority", () => {
  it.each([false, true])("accepts passive status with optional fields omitted (installed=%s)", async (installed) => {
    const value = novaReport(installed); get.mockResolvedValue(value)
    expect(await service.getNovaAppSetup()).toEqual(value)
    expect(get).toHaveBeenCalledExactlyOnceWith("plugins/nova/app")
  })
  it("preserves an existing older incompatible app instead of treating it as missing", async () => {
    const value = novaReport(true)
    value.app = { ...value.app!, version: "0.2.1", connector_compatible: false }
    get.mockResolvedValue(value)
    expect((await service.getNovaAppSetup()).app).toMatchObject({ state: "installed", version: "0.2.1", connector_compatible: false })
  })
  it.each(["already_installed", "unsupported", "error"] as const)("accepts a structured %s report without treating capability as success", async (state) => {
    const value = novaReport()
    value.app = { success: false, state, message: "Setup refused", next_action: "Inspect manually" }
    value.install = { available: false, reason: "app_not_missing" }
    get.mockResolvedValue(value)
    expect((await service.getNovaAppSetup()).app).toEqual(value.app)
  })
  it("accepts Windows direct MCP with an artifact and owned server but no app capability", async () => {
    const value = novaReport()
    value.host = { os: "windows", arch: "x86_64", supported: false, reason: "app_not_required" }
    value.capability = { supported: false, reason: "app_not_required" }; value.app = null
    value.install = { available: false, reason: "app_not_required" }
    get.mockResolvedValue(value)
    expect(await service.getNovaAppSetup()).toEqual(value)
  })
  it.each(["legacy_cli_unavailable", "invalid_report", "status_failed", "status_timeout"])("preserves %s as unavailable rather than missing", async (reason) => {
    const value = novaReport(); value.capability = { supported: false, reason }; value.app = null
    value.install = { available: false, reason }
    get.mockResolvedValue(value)
    expect((await service.getNovaAppSetup()).app).toBeNull()
  })
  it.each([
    ["missing report", () => null],
    ["unknown connector state", (r) => ({ ...r, connector: { ...r.connector, state: "ready" } })],
    ["unknown app state", (r) => ({ ...r, app: { ...r.app, state: "ready" } })],
    ["success contradicts missing", (r) => ({ ...r, app: { ...r.app, success: false } })],
    ["missing capability", (r) => ({ ...r, capability: { supported: false, reason: null } })],
    ["unknown readiness claim", (r) => ({ ...r, desktop_readiness: "ready" })],
    ["unsafe server ID", (r) => ({ ...r, desktop_server_id: "nova/../chrome" })],
    ["unverified server ownership", (r) => ({ ...r, connector: { ...r.connector, state: "unverified" } })],
    ["unsupported install host", (r) => ({ ...r, host: { ...r.host, supported: false } })],
    ["missing artifact", (r) => ({ ...r, artifact: null })],
    ["wrong signing mode", (r) => ({ ...r, artifact: { ...r.artifact, install_mode: "local_self_signed" } })],
    ["nondevelopment artifact", (r) => ({ ...r, artifact: { ...r.artifact, development: false } })],
    ["bad checksum", (r) => ({ ...r, artifact: { ...r.artifact, sha256: "unknown" } })],
    ["mismatched connector artifact", (r) => ({ ...r, connector: { ...r.connector, version: "0.3.0" } })],
  ] satisfies [string, (r: NovaAppSetupReport) => unknown][])("rejects %s instead of authorizing setup", async (_name, alter) => {
    get.mockResolvedValue(alter(novaReport()))
    await expect(service.getNovaAppSetup()).rejects.toThrow("could not be verified")
  })
  it.each(["connector.state", "app.state", "app.signing"])("rejects a non-string %s enum instead of coercing it", async (field) => {
    const value = novaReport(true)
    if (field === "connector.state") get.mockResolvedValue({ ...value, connector: { ...value.connector, state: ["verified"] }, app: null, capability: { supported: false, reason: "status_failed" }, desktop_server_id: null })
    if (field === "app.state") get.mockResolvedValue({ ...value, app: { ...value.app, state: ["error"], success: false } })
    if (field === "app.signing") get.mockResolvedValue({ ...value, app: { ...value.app, signing: ["ad_hoc"] } })
    await expect(service.getNovaAppSetup()).rejects.toThrow("could not be verified")
  })
  it.each(["path", "version", "signing", "development", "connector_compatible"])("rejects installed status missing %s", async (field) => {
    const value = novaReport(true)
    const app = { ...value.app }; delete app[field as keyof typeof app]
    get.mockResolvedValue({ ...value, app })
    await expect(service.getNovaAppSetup()).rejects.toThrow("could not be verified")
  })
  it("binds explicit installation only to the GET artifact ID, with no download or signing fields", async () => {
    const value = novaReport(); get.mockResolvedValue(value)
    const post = vi.spyOn(apiClient, "post").mockResolvedValue(novaReport(true))
    await service.installNovaApp((await service.getNovaAppSetup()).artifact!.artifact_id)
    expect(post).toHaveBeenCalledExactlyOnceWith("plugins/nova/app/install", { artifact_id: "fixture-reviewed-app" })
  })
})


const novaLifecycleReport = (): NovaAppSetupReport => ({
  ...novaReport(true),
  start: { available: true, reason: null },
  observation: {
    schema_version: 1, observed_at: new Date().toISOString(), app_runtime: "not_verified", permissions: "not_verified",
    mcp: { server_id: "nova", state: "not_observed", tool_count: 0, configuration_applied: "not_verified" },
  },
})

describe("Nova explicit lifecycle contract", () => {
  it("accepts additive observations without promoting runtime or permissions", async () => {
    const value = novaLifecycleReport(); get.mockResolvedValue(value)
    expect(await service.getNovaAppSetup()).toEqual(value)
    expect(value.desktop_readiness).toBe("not_tested")
  })
  it.each([
    (r: NovaAppSetupReport) => ({ ...r, observation: undefined }),
    (r: NovaAppSetupReport) => ({ ...r, start: undefined }),
    (r: NovaAppSetupReport) => ({ ...r, observation: { ...r.observation, schema_version: 2 } }),
    (r: NovaAppSetupReport) => ({ ...r, observation: { ...r.observation, observed_at: "invalid" } }),
    (r: NovaAppSetupReport) => ({ ...r, observation: { ...r.observation, app_runtime: "running" } }),
    (r: NovaAppSetupReport) => ({ ...r, observation: { ...r.observation, permissions: "granted" } }),
    (r: NovaAppSetupReport) => ({ ...r, observation: { ...r.observation, mcp: { ...r.observation!.mcp, server_id: "chrome" } } }),
    (r: NovaAppSetupReport) => ({ ...r, observation: { ...r.observation, mcp: { ...r.observation!.mcp, server_id: null, state: "ready" } } }),
    (r: NovaAppSetupReport) => ({ ...r, observation: { ...r.observation, mcp: { ...r.observation!.mcp, tool_count: -1 } } }),
    (r: NovaAppSetupReport) => ({ ...r, observation: { ...r.observation, mcp: { ...r.observation!.mcp, configuration_applied: "applied" } } }),
    (r: NovaAppSetupReport) => ({ ...r, app: { ...r.app, connector_compatible: false } }),
    (r: NovaAppSetupReport) => ({ ...r, app: { ...r.app, version: "0.2.1" } }),
  ])("rejects malformed or contradictory lifecycle authority %#", async (alter) => {
    get.mockResolvedValue(alter(novaLifecycleReport()))
    await expect(service.getNovaAppSetup()).rejects.toThrow("could not be verified")
  })
  it("sends only the observed version/time and requires an explicit launch receipt", async () => {
    const report = novaLifecycleReport()
    const post = vi.spyOn(apiClient, "post").mockResolvedValue({ action: "start_requested", setup: report })
    post.mockClear()
    await expect(service.startNovaApp(report)).resolves.toBeUndefined()
    expect(post).toHaveBeenCalledExactlyOnceWith("plugins/nova/app/start", {
      observed_at: report.observation!.observed_at, app_version: "0.3.1",
    })
    post.mockResolvedValue({ action: "running", setup: report })
    await expect(service.startNovaApp(report)).rejects.toThrow("could not be confirmed")
  })
  it("does not synthesize startup support on an older setup report", async () => {
    const post = vi.spyOn(apiClient, "post").mockResolvedValue({})
    post.mockClear()
    await expect(service.startNovaApp(novaReport(true))).rejects.toThrow("could not be verified")
    expect(post).not.toHaveBeenCalled()
  })
})

describe("official Nova install rejection reasons", () => {
  const rejected = (body?: string) => new ApiError("Conflict", 409, "Conflict", body)

  it("reads the finite reason from the preserved error body", () => {
    expect(novaInstallReason(rejected(JSON.stringify({
      error: { type: "official_nova_unavailable", reason: "archive_checksum_mismatch" },
    })))).toBe("archive_checksum_mismatch")
  })

  it.each([
    ["no body", undefined],
    ["non-JSON body", "not json"],
    ["missing error object", JSON.stringify({ message: "Conflict" })],
    ["missing reason", JSON.stringify({ error: { type: "official_nova_unavailable" } })],
    ["non-string reason", JSON.stringify({ error: { reason: 42 } })],
    // Only stable identifier shapes are surfaced; arbitrary server text must
    // never reach the UI through this helper.
    ["prose reason", JSON.stringify({ error: { reason: "Nova.app failed to install!" } })],
    ["over-long reason", JSON.stringify({ error: { reason: "a".repeat(65) } })],
  ])("falls back to null for %s", (_label, body) => {
    expect(novaInstallReason(rejected(body))).toBeNull()
  })

  it("ignores non-HTTP failures that carry no server reason", () => {
    expect(novaInstallReason(new Error("network exploded"))).toBeNull()
    expect(novaInstallReason(undefined)).toBeNull()
  })
})
