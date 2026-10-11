import { beforeEach, describe, expect, it, vi } from "vitest"
import { apiClient, ApiError } from "@services/api"
import { PluginService } from "./PluginService"
import type { JianduSetupReport } from "./types"

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
