import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { apiClient, ApiError } from "@services/api"
import type { InstalledPluginView } from "@services/plugin"
import { changeLocale } from "@shared/i18n"
import { SettingsPlugins } from "./SettingsPlugins"
import { NOVA_PLUGIN } from "./plugins/officialPlugins"

const roots: Root[] = []
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const nova = (): InstalledPluginView => ({
  id: "nova", name: "Nova Desktop Automation", version: "0.3.0", status: "installed",
  source: NOVA_PLUGIN.source, registered: { mcp_server_ids: ["nova"], skill_dirs: ["nova-grounding"] },
})
const server = (enabled = false, status = "stopped") => ({
  id: "nova", name: "Nova Desktop Automation", enabled,
  config: { id: "nova", enabled, transport: { type: "stdio", command: "/plugins/nova/nova", args: ["mcp"], env: {} } },
  runtime: { status, tool_count: status === "ready" ? 3 : 0 },
})
let inventory: InstalledPluginView[]
let servers: ReturnType<typeof server>[]
const get = vi.fn(); const post = vi.fn(); const remove = vi.fn()
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button")]
  .find((element) => element.textContent?.trim() === name)!
const clickElement = async (element: HTMLElement) => act(async () => {
  element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
  element.click()
})
const click = (name: string) => clickElement(button(name))
const installed = () => clickElement(document.querySelector<HTMLElement>('[role="tab"][id$="trigger-installed"]')!)
const fill = async (input: HTMLInputElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
})
async function mount() {
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  roots.push(root)
  await act(async () => { root.render(<SettingsPlugins />) })
}
beforeEach(() => {
  inventory = []; servers = []
  get.mockReset().mockImplementation(async (path) => path === "plugins" ? { plugins: inventory } : { servers })
  post.mockReset().mockImplementation(async (path) => {
    if (path === "plugins/install") inventory = [nova()]
    if (path === "mcp/servers/nova/connect") servers = [server(true, "ready")]
    if (path === "mcp/servers/nova/disconnect") servers = [server(false)]
    return nova()
  })
  remove.mockReset().mockImplementation(async () => { inventory = []; servers = [] })
  vi.spyOn(apiClient, "get").mockImplementation(get)
  vi.spyOn(apiClient, "post").mockImplementation(post)
  vi.spyOn(apiClient, "delete").mockImplementation(remove)
})
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.replaceChildren()
})

describe("official plugin center", () => {
  it("explains built-in Jiandu memory and withholds its unpublished connector", async () => {
    await mount()
    const card = document.querySelector('article[aria-label="Jiandu"]')!
    expect(card.textContent).toContain("基础记忆已内置")
    expect(card.textContent).toContain("无需安装此连接器")
    expect(card.querySelector("button")?.disabled).toBe(true)
    expect(card.querySelector("a")).toBeNull()
    expect(document.body.textContent).toContain("另外安装并运行 Nova.app")
    expect(document.body.textContent).toContain("运行 Bamboo 的电脑")
    expect(post).not.toHaveBeenCalled()
    await installed()
    expect(document.body.textContent).toContain("暂无插件")
  })

  it("uses the pinned verified package source and prevents duplicate clicks during installation", async () => {
    const pending = deferred<unknown>()
    post.mockReturnValueOnce(pending.promise)
    await mount()
    await click("安装 Nova 插件")
    expect(button("安装中…").disabled).toBe(true)
    expect(button("高级安装").disabled).toBe(true)
    await click("安装中…")
    expect(post).toHaveBeenCalledExactlyOnceWith("plugins/install", { source: NOVA_PLUGIN.source })
    await act(async () => { inventory = [nova()]; pending.resolve(nova()) })
    expect(button("管理已安装插件").disabled).toBe(false)
    expect(document.querySelector('[role="alert"]')).toBeNull()
    await click("管理已安装插件")
    expect(document.body.textContent).toContain("Nova Desktop Automation")
  })

  it("shows a safe failure and allows a deliberate retry after confirming the inventory", async () => {
    post.mockRejectedValueOnce(new ApiError("SECRET_INSTALL_DETAILS", 500, "Internal Server Error"))
    await mount(); await click("安装 Nova 插件")
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("可再次安装")
    expect(document.body.textContent).not.toContain("SECRET_INSTALL_DETAILS")
    expect(button("安装 Nova 插件").disabled).toBe(false)
    await click("安装 Nova 插件")
    expect(post).toHaveBeenCalledTimes(2)
    expect(button("管理已安装插件")).toBeDefined()
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })

  it("reconciles an uncertain install response with the actual installed list before offering a retry", async () => {
    post.mockImplementationOnce(async () => { inventory = [nova()]; throw new Error("response lost") })
    await mount(); await click("安装 Nova 插件")
    expect(button("管理已安装插件")).toBeDefined()
    expect(document.querySelector('[role="alert"]')).toBeNull()
    expect(post).toHaveBeenCalledTimes(1)
  })

  it("does not turn a malformed inventory into an empty list or an enabled install action", async () => {
    get.mockImplementation(async (path) => path === "plugins" ? { plugins: { unknown: true } } : { servers: [] })
    await mount()
    expect(button("安装 Nova 插件").disabled).toBe(true)
    expect(button("高级安装").disabled).toBe(true)
    await installed()
    expect(document.body.textContent).not.toContain("暂无插件")
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("无法确认")
    get.mockImplementation(async (path) => path === "plugins" ? { plugins: [] } : { servers: [] })
    await click("重试")
    expect(document.body.textContent).toContain("暂无插件")
  })

  it("blocks reinstall if post-install inventory reconciliation fails", async () => {
    await mount()
    get.mockImplementation(async (path) => {
      if (path === "plugins") throw new Error("offline")
      return { servers: [] }
    })
    await click("安装 Nova 插件")
    expect(button("安装 Nova 插件").disabled).toBe(true)
    expect(document.body.textContent).toContain("无法确认已安装插件列表")
    expect(post).toHaveBeenCalledTimes(1)
  })

  it("shows existing package and connection state without declaring desktop permissions ready", async () => {
    inventory = [nova()]; servers = [server(true, "ready")]
    await mount()
    expect(button("安装 Nova 插件")).toBeUndefined()
    await click("管理已安装插件")
    expect(document.body.textContent).toContain("已连接")
    expect(document.body.textContent).toContain("尚未验证桌面权限")
    expect(document.body.textContent).toContain("此页面无法检查这些权限")
    expect(post).not.toHaveBeenCalled()
  })

  it("updates actual MCP enable and connection state through the existing APIs", async () => {
    inventory = [nova()]; servers = [server()]
    await mount(); await installed()
    const toggle = () => document.querySelector<HTMLElement>('[role="switch"]')!
    expect(toggle().getAttribute("aria-checked")).toBe("false")
    await clickElement(toggle())
    expect(post).toHaveBeenLastCalledWith("mcp/servers/nova/connect")
    expect(toggle().getAttribute("aria-checked")).toBe("true")
    expect(document.body.textContent).toContain("已连接")
    await clickElement(toggle())
    expect(post).toHaveBeenLastCalledWith("mcp/servers/nova/disconnect")
    expect(toggle().getAttribute("aria-checked")).toBe("false")
    expect(document.body.textContent).toContain("已禁用")
  })

  it("keeps MCP runtime failure separate from successful package inventory", async () => {
    inventory = [nova()]
    get.mockImplementation(async (path) => {
      if (path === "mcp/servers") throw new Error("unavailable")
      return { plugins: inventory }
    })
    await mount(); await installed()
    expect(document.body.textContent).toContain("无法确认连接状态")
    expect(document.querySelector('[role="switch"]')).toBeNull()
    expect(button("更新").disabled).toBe(false)
  })

  it("reconciles a failed connection action without optimistically enabling the server", async () => {
    inventory = [nova()]; servers = [server()]
    post.mockRejectedValueOnce(new Error("SECRET_RUNTIME_ERROR"))
    await mount(); await installed()
    await clickElement(document.querySelector<HTMLElement>('[role="switch"]')!)
    expect(document.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false")
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("无法确认连接变更结果")
    expect(document.body.textContent).not.toContain("SECRET_RUNTIME_ERROR")
  })

  it("keeps advanced URL installation and installed package updates", async () => {
    await mount(); await click("高级安装")
    await fill(document.querySelector<HTMLInputElement>('input[placeholder="https://example.com/plugin.zip"]')!, "https://example.test/custom.zip")
    await click("安装")
    expect(post).toHaveBeenLastCalledWith("plugins/install", { source: { type: "url", url: "https://example.test/custom.zip", sha256: undefined } })
    await click("更新")
    const url = document.querySelector<HTMLInputElement>('input[placeholder="https://example.com/plugin.zip"]')!
    expect(url.value).toBe(NOVA_PLUGIN.source.url)
    await fill(url, "https://example.test/update.zip")
    await clickElement([...document.querySelectorAll<HTMLButtonElement>("button")].filter((item) => item.textContent?.trim() === "更新").at(-1)!)
    expect(post).toHaveBeenLastCalledWith("plugins/nova/update", { source: { type: "url", url: "https://example.test/update.zip", sha256: NOVA_PLUGIN.source.sha256 } })
  })

  it("removes only the selected package through the existing uninstall endpoint", async () => {
    inventory = [nova()]; servers = [server()]
    await mount(); await installed(); await click("删除")
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain("Nova Desktop Automation")
    await clickElement([...dialog.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === "删除")!)
    expect(remove).toHaveBeenCalledExactlyOnceWith("plugins/nova")
    expect(document.body.textContent).toContain("暂无插件")
  })

  it("closes the removal dialog when reconciliation confirms a lost response was applied", async () => {
    inventory = [nova()]; servers = [server()]
    remove.mockImplementationOnce(async () => {
      inventory = []; servers = []
      throw new Error("response lost")
    })
    await mount(); await installed(); await click("删除")
    const dialog = document.querySelector('[role="dialog"]')!
    await clickElement([...dialog.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === "删除")!)
    expect(remove).toHaveBeenCalledExactlyOnceWith("plugins/nova")
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.body.textContent).toContain("暂无插件")
    expect(document.body.textContent).not.toContain("response lost")
  })

  it("keeps uncertain removal open when inventory reconciliation fails", async () => {
    inventory = [nova()]; servers = [server()]
    remove.mockImplementationOnce(async () => {
      inventory = []; servers = []
      throw new Error("response lost")
    })
    await mount(); await installed(); await click("删除")
    get.mockImplementation(async (path) => {
      if (path === "plugins") throw new Error("inventory unavailable")
      return { servers }
    })
    const dialog = document.querySelector('[role="dialog"]')!
    await clickElement([...dialog.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === "删除")!)
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("response lost")
    expect(document.body.textContent).not.toContain("暂无插件")
    const retry = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === "删除")!
    expect(retry.disabled).toBe(true)
    expect(remove).toHaveBeenCalledExactlyOnceWith("plugins/nova")
  })

  it("fences a stale automatic poll from undoing a completed installation", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    const stale = deferred<unknown>()
    let reads = 0
    get.mockImplementation(async (path) => {
      if (path !== "plugins") return { servers: [] }
      reads += 1
      return reads === 2 ? stale.promise : { plugins: inventory }
    })
    await mount()
    await act(async () => { vi.advanceTimersByTime(10_000) })
    await click("安装 Nova 插件")
    expect(button("管理已安装插件")).toBeDefined()
    await act(async () => { stale.resolve({ plugins: [] }) })
    expect(button("管理已安装插件")).toBeDefined()
    expect(button("安装 Nova 插件")).toBeUndefined()
  })

  it("localizes discovery and setup guidance in English", async () => {
    await changeLocale("en-US"); await mount()
    expect(button("Install Nova plugin")).toBeDefined()
    expect(document.body.textContent).toContain("Basic memory is built in")
    expect(document.body.textContent).toContain("Install and run Nova.app separately")
    expect(document.body.textContent).not.toContain("ui.plugin_")
  })
})
