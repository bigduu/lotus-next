import { render } from "@solidjs/web"
import { flush } from "solid-js"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import {
  JianduMemoryApiError,
  type JianduMemoryApiClient,
  type JianduMemoryDetail,
  type JianduMemoryListItem,
  type JianduMemoryPage,
  type JianduProjectContext,
} from "@/services/memory/jianduMemoryApi"
import { changeLocale } from "@shared/i18n/runtime"
import { appStore } from "@shared/store/appStore/state"
import { JianduProjectMemories } from "./JianduProjectMemories"

// Use the compiled entries of the same Kobalte primitives as the app.
const compiledPrimitive = vi.hoisted(() => async (name: string) => {
  const { createRequire } = await vi.importActual<{
    createRequire: (url: string) => { resolve: (specifier: string) => string }
  }>("node:module")
  return vi.importActual(createRequire(import.meta.url).resolve(name).replace(/\.jsx$/, ".js"))
})
vi.mock("@kobalte/core/dialog", () => compiledPrimitive("@kobalte/core/dialog"))
vi.mock("@kobalte/core/select", () => compiledPrimitive("@kobalte/core/select"))
vi.mock("@lucide/solid", () => ({
  X: () => null, Check: () => null, ChevronDown: () => null,
}))

const cleanups: Array<() => void> = []
const initialStore = appStore.getState()
async function settleUpdate(action: () => unknown) {
  await action()
  for (let turn = 0; turn < 5; turn += 1) {
    await Promise.resolve()
    flush()
  }
}
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView")
const context = (id = "alpha"): JianduProjectContext => ({
  activeSessionId: id, activeSessionTitle: `Session ${id}`,
  authoritySessionId: id, authoritySessionTitle: `Session ${id}`, projectId: `Project ${id}`,
})
const item = (id = "alpha"): JianduMemoryListItem => ({
  id, title: `Memory ${id}`, summary: `Summary ${id}`, type: "project", status: "active", tags: [],
})
const detail = (id = "alpha"): JianduMemoryDetail => ({
  ...item(id), body: `<script>inert ${id}</script>`, bodyTruncated: false,
  retrievalMetadataTruncated: false, createdAt: "2026-09-05", updatedAt: "2026-09-05", keywords: [], entities: [],
})
const page = (items: JianduMemoryListItem[] = [], extra: Partial<JianduMemoryPage> = {}): JianduMemoryPage => ({
  items, returnedCount: items.length, matchedCount: items.length, remainingCount: 0, truncated: false, ...extra,
})
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => { resolve = accept })
  return { promise, resolve }
}
const client = () => ({
  resolveProjectContext: vi.fn<JianduMemoryApiClient["resolveProjectContext"]>().mockImplementation(async (id) => context(id)),
  queryProjectMemories: vi.fn<JianduMemoryApiClient["queryProjectMemories"]>().mockResolvedValue(page()),
  getProjectMemory: vi.fn<JianduMemoryApiClient["getProjectMemory"]>().mockImplementation(async (_, id) => detail(id)),
  createProjectMemory: vi.fn<JianduMemoryApiClient["createProjectMemory"]>().mockResolvedValue(item("created")),
  archiveProjectMemory: vi.fn<JianduMemoryApiClient["archiveProjectMemory"]>().mockResolvedValue(undefined),
})
const button = (name: string, scope: ParentNode = document): HTMLButtonElement => {
  const found = [...scope.querySelectorAll("button")].find((element) => element.textContent === name)
  expect(found, `Button ${name}`).toBeDefined()
  return found!
}
const click = async (name: string, scope?: ParentNode) => {
  await settleUpdate(async () => { button(name, scope).click() })
}
const settle = async <T,>(pending: ReturnType<typeof deferred<T>>, value: T) => {
  await settleUpdate(async () => { pending.resolve(value) })
}
const change = async (selector: string, value: string) => {
  const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)
  expect(input).not.toBeNull()
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await settleUpdate(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value)
    input!.dispatchEvent(new Event("input", { bubbles: true }))
  })
}
const switchSession = async (id: string) => {
  await settleUpdate(async () => { appStore.setState({ currentSessionId: id }) })
}
const mount = async (api: JianduMemoryApiClient, sessionId: string | null = "alpha") => {
  appStore.setState({ currentSessionId: sessionId })
  const container = document.body.appendChild(document.createElement("div"))
  const dispose = render(() => <JianduProjectMemories api={api} />, container)
  cleanups.push(() => { dispose(); container.remove() })
  await settleUpdate(() => {})
}
const draft = async () => {
  await click("新建记忆")
  await change("#jiandu-title", "Unique marker")
  await change("#jiandu-body", "Confirmed project behavior")
}
const archiveDialog = () => [...document.querySelectorAll('[role="dialog"][data-state="open"]')]
  .find((element) => element.querySelector("h2")?.textContent === "归档“Memory alpha”？")!

beforeAll(async () => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() })
  await changeLocale("zh-CN", { persist: false })
})
afterAll(() => {
  if (originalScroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScroll)
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView")
})
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  appStore.setState(initialStore, true)
  vi.restoreAllMocks()
})

describe("Jiandu Project Settings", () => {
  it("fails closed without a Project session and never treats it as an empty list", async () => {
    const api = client()
    await mount(api, null)
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("未绑定可用项目")
    expect(button("新建记忆").disabled).toBe(true)
    expect(api.resolveProjectContext).not.toHaveBeenCalled()
    expect(api.queryProjectMemories).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toContain("没有匹配的项目记忆")
  })

  it("ignores an earlier context resolution after selecting another Project", async () => {
    const api = client()
    const pending = deferred<JianduProjectContext>()
    api.resolveProjectContext.mockReturnValueOnce(pending.promise)
    await mount(api)
    await switchSession("beta")
    await settle(pending, context())
    expect(document.body.textContent).toContain("Project beta")
    expect(document.body.textContent).not.toContain("Project alpha")
    expect(api.queryProjectMemories).toHaveBeenCalledTimes(1)
    expect(api.queryProjectMemories.mock.calls[0][0]).toEqual(context("beta"))
  })

  it("retrieves only selected detail, renders inert text and discards a late closed detail", async () => {
    const api = client()
    api.queryProjectMemories.mockResolvedValue(page([item()]))
    const pending = deferred<JianduMemoryDetail>()
    api.getProjectMemory.mockReturnValueOnce(pending.promise)
    await mount(api)
    expect(api.getProjectMemory).not.toHaveBeenCalled()
    await click("Memory alpha")
    await click("关闭详情")
    await settle(pending, detail())
    expect(document.querySelector('[role="dialog"][data-state="open"]')).toBeNull()
    await click("Memory alpha")
    expect(document.querySelector("pre")?.textContent).toBe(detail().body)
    expect(document.querySelector("script")).toBeNull()
    expect(api.getProjectMemory).toHaveBeenLastCalledWith(context(), "alpha")
    await switchSession("beta")
    expect(document.querySelector("pre")).toBeNull()
  })

  it("keeps the applied search separate from unsent text when paginating and refreshing", async () => {
    const api = client()
    api.queryProjectMemories.mockResolvedValue(page([item()], { nextCursor: "alpha-cursor", matchedCount: 2, remainingCount: 1 }))
    await mount(api)
    await change('input[aria-label="搜索项目记忆"]', "applied")
    await click("搜索")
    const applied = api.queryProjectMemories.mock.calls.at(-1)![1]
    await change('input[aria-label="搜索项目记忆"]', "unsent")
    await click("加载更多")
    expect(api.queryProjectMemories).toHaveBeenLastCalledWith(context(), { ...applied, cursor: "alpha-cursor" })
    await click("刷新")
    expect(api.queryProjectMemories).toHaveBeenLastCalledWith(context(), applied)
  })

  it("permits a first record only after successful unfiltered empty inventory and explicit create", async () => {
    const api = client()
    await mount(api)
    await draft()
    expect(button("明确创建").disabled).toBe(true)
    await click("查找相似记忆")
    expect(api.queryProjectMemories).toHaveBeenLastCalledWith(context(), { query: "", limit: 1 })
    expect(api.queryProjectMemories).toHaveBeenCalledTimes(2)
    expect(api.createProjectMemory).not.toHaveBeenCalled()
    expect(button("明确创建").disabled).toBe(false)
    await click("明确创建")
    expect(api.resolveProjectContext).toHaveBeenCalledTimes(2)
    expect(api.createProjectMemory).toHaveBeenCalledWith(context(), expect.objectContaining({ title: "Unique marker", content: "Confirmed project behavior", type: "project" }))
  })

  it("applies archived status only with Search and keeps archived detail read-only", async () => {
    const api = client()
    await mount(api)
    expect(api.queryProjectMemories).toHaveBeenLastCalledWith(context(), { query: "", filters: { status: ["active"] } })
    const trigger = document.querySelector('[role="combobox"][aria-label="记忆状态"]')
    expect(trigger).not.toBeNull()
    await settleUpdate(async () => { trigger!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })) })
    const option = [...document.querySelectorAll('[role="option"]')].find((element) => element.textContent === "已归档")!
    expect(option).toBeDefined()
    await settleUpdate(async () => { option.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })) })
    expect(api.queryProjectMemories).toHaveBeenCalledTimes(1)
    const archived = { ...item(), status: "archived" as const }
    api.queryProjectMemories.mockResolvedValue(page([archived]))
    await click("搜索")
    expect(api.queryProjectMemories).toHaveBeenLastCalledWith(context(), { query: "", filters: { status: ["archived"] } })
    api.getProjectMemory.mockResolvedValue({ ...detail(), status: "archived" })
    await click("Memory alpha")
    expect(document.querySelector("pre")?.textContent).toBe(detail().body)
    expect(document.querySelector('[role="dialog"][data-state="open"]')?.textContent).not.toContain("归档记忆")
    expect(api.archiveProjectMemory).not.toHaveBeenCalled()
  })

  it("requires lexical lookup for nonempty inventory and invalidates an in-flight result on draft edit", async () => {
    const api = client()
    await mount(api)
    await draft()
    const pending = deferred<JianduMemoryPage>()
    api.queryProjectMemories.mockResolvedValueOnce(page([item()])).mockReturnValueOnce(pending.promise)
    await click("查找相似记忆")
    expect(api.queryProjectMemories).toHaveBeenLastCalledWith(context(), { query: "Unique marker", limit: 5 })
    await change("#jiandu-title", "Different marker")
    await settle(pending, page([item()]))
    expect(button("明确创建").disabled).toBe(true)
    expect(document.querySelector('[aria-label="创建前查重结果"]')).toBeNull()
    expect(api.createProjectMemory).not.toHaveBeenCalled()
  })

  it("never converts a failed inventory into permission to write", async () => {
    const api = client()
    await mount(api)
    await draft()
    api.queryProjectMemories.mockRejectedValueOnce(new JianduMemoryApiError("request_failed"))
    await click("查找相似记忆")
    expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain("暂时无法访问")
    expect(button("明确创建").disabled).toBe(true)
    expect(document.body.textContent).not.toContain("未找到相似记忆")
    expect(api.createProjectMemory).not.toHaveBeenCalled()
  })

  it("closes old overlays and refuses mutation when server authority changes during revalidation", async () => {
    const api = client()
    await mount(api)
    await draft()
    await click("查找相似记忆")
    api.resolveProjectContext.mockResolvedValueOnce(context("unexpected"))
    await click("明确创建")
    expect(api.createProjectMemory).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"][data-state="open"]')).toBeNull()
    expect(document.body.textContent).toContain("未绑定可用项目")
    expect(button("新建记忆").disabled).toBe(true)
  })

  it("requires named archive confirmation, allows cancel and exposes failures inside the confirmation", async () => {
    const api = client()
    api.queryProjectMemories.mockResolvedValue(page([item()]))
    await mount(api)
    await click("Memory alpha")
    await click("归档记忆")
    expect(archiveDialog()).toBeDefined()
    await click("取消归档", archiveDialog())
    expect(api.archiveProjectMemory).not.toHaveBeenCalled()
    await click("归档记忆")
    api.archiveProjectMemory.mockRejectedValueOnce(new JianduMemoryApiError("access_denied"))
    await click("确认归档", archiveDialog())
    expect(api.archiveProjectMemory).toHaveBeenCalledExactlyOnceWith(context(), "alpha")
    expect(archiveDialog().querySelector('[role="alert"]')?.textContent).toContain("没有访问")
  })

  it("reports successful create separately from a failed list refresh and disables duplicate submission", async () => {
    const api = client()
    await mount(api)
    await draft()
    await click("查找相似记忆")
    const pending = deferred<JianduMemoryListItem>()
    api.createProjectMemory.mockReturnValueOnce(pending.promise)
    await click("明确创建")
    expect(button("正在创建…").disabled).toBe(true)
    await click("正在创建…")
    expect(api.createProjectMemory).toHaveBeenCalledTimes(1)
    api.queryProjectMemories.mockRejectedValueOnce(new JianduMemoryApiError("request_failed"))
    await settle(pending, item("created"))
    expect(document.body.textContent).toContain("已创建“Memory created”，但列表刷新失败")
    expect(document.querySelector('[role="dialog"][data-state="open"]')).toBeNull()
  })

  it("cannot clear another Project draft when an old write finishes and never stores memory bodies locally", async () => {
    const api = client()
    const storage = vi.spyOn(window.localStorage, "setItem")
    await mount(api)
    await draft()
    await click("查找相似记忆")
    const pending = deferred<JianduMemoryListItem>()
    api.createProjectMemory.mockReturnValueOnce(pending.promise)
    await click("明确创建")
    await switchSession("beta")
    await draft()
    await change("#jiandu-title", "Beta draft")
    await settle(pending, item("created"))
    expect(document.querySelector<HTMLInputElement>("#jiandu-title")?.value).toBe("Beta draft")
    expect(document.body.textContent).not.toContain("已创建“Memory created”")
    expect(storage.mock.calls.some(([, value]) => value.includes("Confirmed project behavior"))).toBe(false)
  })

  it("discards a late Project list and a late blank-inventory result after changing context", async () => {
    const api = client()
    const oldList = deferred<JianduMemoryPage>()
    api.queryProjectMemories.mockReturnValueOnce(oldList.promise)
    await mount(api)
    await draft()
    const oldInventory = deferred<JianduMemoryPage>()
    api.queryProjectMemories.mockReturnValueOnce(oldInventory.promise)
    await click("查找相似记忆")
    await switchSession("beta")
    await draft()
    await settle(oldList, page([item("private-alpha")]))
    await settle(oldInventory, page())
    expect(document.body.textContent).not.toContain("private-alpha")
    expect(button("明确创建").disabled).toBe(true)
    expect(api.createProjectMemory).not.toHaveBeenCalled()
  })

  it("reports successful archive separately from refresh failure without retrying the archive", async () => {
    const api = client()
    api.queryProjectMemories.mockResolvedValue(page([item()]))
    await mount(api)
    await click("Memory alpha")
    await click("归档记忆")
    const pending = deferred<void>()
    api.archiveProjectMemory.mockReturnValueOnce(pending.promise)
    await click("确认归档", archiveDialog())
    expect(button("正在归档…", archiveDialog()).disabled).toBe(true)
    await click("正在归档…", archiveDialog())
    api.queryProjectMemories.mockRejectedValueOnce(new JianduMemoryApiError("request_failed"))
    await settle(pending, undefined)
    expect(api.archiveProjectMemory).toHaveBeenCalledExactlyOnceWith(context(), "alpha")
    expect(document.body.textContent).toContain("已归档“Memory alpha”，但列表刷新失败")
    expect(document.querySelector('[role="dialog"][data-state="open"]')).toBeNull()
  })
})
