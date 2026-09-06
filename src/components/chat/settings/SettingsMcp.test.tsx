import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { apiClient, ApiError } from "@services/api"
import { McpService, mcpService } from "@services/mcp"
import { SettingsMcp } from "./SettingsMcp"

const roots: Root[] = []
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
environment.IS_REACT_ACT_ENVIRONMENT = true
const record = (id: string, type = "stdio", status = "stopped") => ({
  id, name: id, enabled: false, status, config: { id, enabled: false,
    transport: type === "stdio" ? { type, command: "fixture", args: [], env: {} }
      : { type, url: "https://example.test/mcp", headers: [{ name: "Authorization", value: "****...****" }], connect_timeout_ms: 5432 },
  }, runtime: { status, tool_count: status === "ready" ? 1 : 0 },
})
const source = JSON.stringify({ mcpServers: { incoming: { command: "fixture", disabled: true } } })
const success = (mode = "merge", removed = 0) => ({ mode, added: 1, updated: 0, removed, server_ids: ["incoming"] })
const get = vi.fn(); const post = vi.fn(); const put = vi.fn()
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const button = (name: string) => [...document.querySelectorAll("button")].find((element) => element.textContent?.trim() === name)!
const click = async (name: string) => act(async () => { button(name).click() })
const fill = async (value = source) => act(async () => {
  const input = document.querySelector("textarea")!
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
})
const replace = async () => act(async () => { document.querySelector<HTMLInputElement>('input[type="radio"][value="replace"]')!.click() })
const confirm = async () => act(async () => { document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click() })
async function mount() {
  const root = createRoot(document.body.appendChild(document.createElement("div"))); roots.push(root)
  await act(async () => { root.render(<SettingsMcp />) })
  return root
}
beforeEach(() => {
  get.mockReset().mockResolvedValue({ servers: [record("existing")] })
  post.mockReset().mockResolvedValue(success())
  put.mockReset().mockResolvedValue(undefined)
  vi.spyOn(apiClient, "get").mockImplementation(get)
  vi.spyOn(apiClient, "post").mockImplementation(post)
  vi.spyOn(apiClient, "put").mockImplementation(put)
  const service = new McpService()
  vi.spyOn(mcpService, "importServers").mockImplementation(service.importServers.bind(service))
})
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.replaceChildren()
})

describe("SettingsMcp JSON import integration", () => {
  it("does not call an unknown initial inventory empty or enable import", async () => {
    get.mockResolvedValue({ servers: { unknown: true } })
    await mount()
    expect(button("导入 JSON").disabled).toBe(true)
    expect(document.body.textContent).not.toContain("暂无 MCP 服务器")
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("无法确认")
    expect(post).not.toHaveBeenCalled()
  })

  it("pauses polling during import and fences a late pre-import GET from the refreshed list/runtime", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    const stale = deferred<unknown>(); const mutation = deferred<unknown>()
    await mount()
    get.mockReturnValueOnce(stale.promise).mockResolvedValueOnce({ servers: [record("existing"), record("incoming", "streamablehttp", "ready")] })
    await act(async () => { vi.advanceTimersByTime(10_000) })
    post.mockReturnValueOnce(mutation.promise)
    await click("导入 JSON"); await fill(); await click("导入")
    await act(async () => { vi.advanceTimersByTime(20_000) })
    expect(get).toHaveBeenCalledTimes(2); expect(post).toHaveBeenCalledTimes(1)
    await act(async () => { mutation.resolve(success()) })
    expect(document.querySelector('[aria-label="导入结果"]')?.textContent).toContain("实际服务器列表与运行状态已刷新")
    await act(async () => { stale.resolve({ servers: [record("existing")] }) })
    await click("完成")
    expect(document.body.textContent).toContain("incoming")
    expect(document.body.textContent).toContain("Streamable HTTP")
    expect(document.body.textContent).toContain("已连接 · 1 工具")
    expect(post).toHaveBeenCalledExactlyOnceWith("mcp/servers/import", { ...JSON.parse(source), mode: "merge" })
  })

  it("requires a new Replace confirmation if the final list preflight discovers another ID", async () => {
    await mount(); await click("导入 JSON"); await fill(); await replace(); await confirm()
    get.mockResolvedValueOnce({ servers: [record("existing"), record("newly-discovered")] })
    await click("导入")
    expect(post).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("列表已变化")
    expect(document.querySelector('[aria-label="将删除的服务器"]')?.textContent).toContain("newly-discovered")
    expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false)
    await confirm()
    get.mockResolvedValueOnce({ servers: [record("existing"), record("newly-discovered")] })
      .mockResolvedValueOnce({ servers: [record("incoming")] })
    post.mockResolvedValueOnce(success("replace", 2))
    await click("导入")
    expect(post).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[aria-label="导入结果"]')?.textContent).toContain("删除 2")
  })

  it("does not revive a Replace confirmation when polling changes the inventory and later restores the same IDs", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    await mount(); await click("导入 JSON"); await fill(); await replace(); await confirm()
    expect(button("导入").disabled).toBe(false)
    get.mockResolvedValueOnce({ servers: [record("existing"), record("temporary")] })
    await act(async () => { vi.advanceTimersByTime(10_000) })
    expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false)
    get.mockResolvedValueOnce({ servers: [record("existing")] })
    await act(async () => { vi.advanceTimersByTime(10_000) })
    expect(document.querySelector('[aria-label="将删除的服务器"]')?.textContent).not.toContain("temporary")
    expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false)
    expect(button("导入").disabled).toBe(true)
    expect(post).not.toHaveBeenCalled()
  })

  it("fails Replace closed when preflight returns a malformed list instead of assuming no removals", async () => {
    await mount(); await click("导入 JSON"); await fill(); await replace(); await confirm()
    get.mockResolvedValueOnce({ servers: null })
    await click("导入")
    expect(post).not.toHaveBeenCalled()
    expect(button("导入").disabled).toBe(true)
    expect(document.body.textContent).toContain("尚未发送导入请求")
    expect(document.querySelector('[aria-label="导入结果"]')).toBeNull()
  })

  it("keeps actual existing rows after rejection and never displays raw backend/runtime secrets", async () => {
    const existing = { ...record("existing", "stdio", "error"), runtime: { status: "error", tool_count: 0, last_error: "SECRET_RUNTIME_MARKER" } }
    get.mockResolvedValue({ servers: [existing] })
    await mount(); expect(document.body.textContent).not.toContain("SECRET_RUNTIME_MARKER")
    await click("导入 JSON"); await fill()
    post.mockRejectedValueOnce(new ApiError("SECRET_IMPORT_MARKER", 400, "Bad Request", "SECRET_IMPORT_MARKER"))
    await click("导入")
    expect(document.body.textContent).toContain("服务器拒绝了导入")
    expect(document.body.textContent).not.toContain("SECRET_IMPORT_MARKER")
    expect(document.querySelector('[aria-label="导入结果"]')).toBeNull()
    await click("取消")
    expect(document.body.textContent).toContain("existing")
    expect(post).toHaveBeenCalledTimes(1)
  })

  it("does not turn a failed post-success list refresh into a successful runtime-refresh claim", async () => {
    await mount(); await click("导入 JSON"); await fill()
    get.mockRejectedValueOnce(new Error("SECRET_LIST_MARKER"))
    await click("导入")
    expect(document.querySelector('[aria-label="导入结果"]')?.textContent).toContain("配置已提交，但列表刷新失败")
    expect(document.body.textContent).not.toContain("SECRET_LIST_MARKER")
    expect(post).toHaveBeenCalledTimes(1)
    await click("刷新当前列表")
    expect(post).toHaveBeenCalledTimes(1)
  })

  it("restores focus to the scoped import trigger after keyboard cancellation and reopens a clean draft", async () => {
    await mount(); const trigger = button("导入 JSON")
    trigger.focus(); await click("导入 JSON"); await fill()
    await act(async () => { document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })) })
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await click("导入 JSON")
    expect(document.querySelector("textarea")?.value).toBe("")
    expect(document.querySelector<HTMLInputElement>('input[value="merge"]')?.checked).toBe(true)
    expect(post).not.toHaveBeenCalled()
  })

  it("keeps an imported Streamable HTTP server editable without changing its transport, headers or timeout", async () => {
    get.mockResolvedValue({ servers: [record("remote", "streamablehttp")] })
    await mount()
    await act(async () => { document.querySelector<HTMLButtonElement>('button[aria-label="编辑"]')!.click() })
    expect(button("Streamable HTTP(远程)").getAttribute("aria-pressed")).toBe("true")
    expect([...document.querySelectorAll<HTMLInputElement>("input")].some((input) => input.value === "https://example.test/mcp")).toBe(true)
    await click("保存")
    expect(put).toHaveBeenCalledExactlyOnceWith("mcp/servers/remote", expect.objectContaining({ transport: {
      type: "streamable_http", url: "https://example.test/mcp", headers: [{ name: "Authorization", value: "****...****" }], connect_timeout_ms: 5432,
    } }))
  })
});
