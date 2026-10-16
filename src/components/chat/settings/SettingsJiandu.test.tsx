import i18next from "i18next"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { I18nextProvider, initReactI18next } from "react-i18next"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { JianduMemoryApiError, type JianduMemoryOverviewClient, type JianduMemoryOverview } from "@/services/memory/jianduMemoryApi"
import { zhCnTranslation } from "@/shared/i18n/resources/zh-CN"
import { enUsTranslation } from "@/shared/i18n/resources/en-US"
import { useAppStore } from "@/shared/store/appStore"
import { SettingsJiandu } from "./SettingsJiandu"

const projectMount = vi.fn()
vi.mock("./JianduProjectMemories", () => ({ JianduProjectMemories: () => {
  projectMount()
  return <div>Project manager</div>
} }))

const overview: JianduMemoryOverview = {
  totalMemories: 7, globalMemories: 3, projectMemories: 4, projectCount: 2,
  byType: { user: 3, feedback: 0, project: 4, reference: 0 },
  byStatus: { active: 5, stale: 0, superseded: 0, contradicted: 0, archived: 2 },
  lastReindexAt: "2026-10-15T03:00:00Z", lastDreamAt: null,
}
const locale = i18next.createInstance()
const roots: Root[] = []
const initialStore = useAppStore.getState()
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => { resolve = accept })
  return { promise, resolve }
}
const client = () => ({ getOverview: vi.fn<JianduMemoryOverviewClient["getOverview"]>().mockResolvedValue(overview) })
const mount = async (api: JianduMemoryOverviewClient) => {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => { root.render(<I18nextProvider i18n={locale}><SettingsJiandu api={api} /></I18nextProvider>) })
  return root
}
const click = async (name: string) => {
  const button = [...document.querySelectorAll("button")].find((element) => element.textContent === name)
  expect(button, name).toBeDefined()
  await act(async () => { button!.click() })
}
const count = (label: string) => [...document.querySelectorAll("dt")]
  .find((element) => element.textContent === label)?.nextElementSibling?.textContent

beforeAll(async () => {
  environment.IS_REACT_ACT_ENVIRONMENT = true
  await locale.use(initReactI18next).init({ lng: "zh-CN",
    resources: { "zh-CN": zhCnTranslation, "en-US": enUsTranslation }, interpolation: { escapeValue: false } })
})
afterAll(() => { Reflect.deleteProperty(environment, "IS_REACT_ACT_ENVIRONMENT") })
afterEach(async () => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.replaceChildren()
  useAppStore.setState(initialStore, true)
  projectMount.mockClear()
  await locale.changeLanguage("zh-CN")
})

describe("Jiandu System Settings overview", () => {
  it.each([null, "unassigned-session", "project-session", "child-session"])(
    "opens the aggregate overview with active session %s without mounting the Project manager", async (sessionId) => {
      useAppStore.setState({ currentSessionId: sessionId })
      const api = client()
      await mount(api)
      expect(document.querySelector("h2")?.textContent).toBe("记忆总览")
      expect(document.querySelector('[role="alert"]')).toBeNull()
      expect(count("持久记忆总数")).toBe("7")
      expect(count("全局记忆数")).toBe("3")
      expect(count("项目记忆数")).toBe("4")
      expect(count("有记忆数据的项目")).toBe("2")
      expect(document.body.textContent).toContain("会话笔记单独存储，不计入这些数量")
      expect(document.body.textContent).toContain("无项目会话也可使用")
      expect(api.getOverview).toHaveBeenCalledExactlyOnceWith()
      expect(projectMount).not.toHaveBeenCalled()
    },
  )

  it("does not scope or reload the overview when the selected conversation changes", async () => {
    const api = client()
    await mount(api)
    await act(async () => { useAppStore.setState({ currentSessionId: "different-project" }) })
    expect(count("持久记忆总数")).toBe("7")
    expect(api.getOverview).toHaveBeenCalledTimes(1)
    expect(projectMount).not.toHaveBeenCalled()
  })

  it("loads Project management only after an explicit action and refreshes on return", async () => {
    const api = client()
    await mount(api)
    await click("管理当前项目记忆")
    expect(document.body.textContent).toContain("Project manager")
    expect(document.body.textContent).not.toContain("持久记忆总数")
    api.getOverview.mockResolvedValue({ ...overview, lastDreamAt: "2026-10-15T04:00:00Z" })
    await click("返回记忆总览")
    expect(document.querySelector("h2")?.textContent).toBe("记忆总览")
    expect(api.getOverview).toHaveBeenCalledTimes(2)
  })

  it("does not show zero inventory while loading", async () => {
    const pending = deferred<JianduMemoryOverview>()
    const api = client()
    api.getOverview.mockReturnValue(pending.promise)
    await mount(api)
    expect(document.querySelector('[role="status"]')?.textContent).toContain("正在加载记忆总览")
    expect(count("持久记忆总数")).toBeUndefined()
    await act(async () => { pending.resolve(overview) })
    expect(count("持久记忆总数")).toBe("7")
  })

  it.each(["request_failed", "context_unavailable", "access_denied", "malformed_response"] as const)(
    "shows %s as an error without substituting zero inventory", async (code) => {
      const api = client()
      api.getOverview.mockRejectedValueOnce(new JianduMemoryApiError(code))
      await mount(api)
      expect(document.querySelector('[role="alert"]')).not.toBeNull()
      expect(count("持久记忆总数")).toBeUndefined()
      await click("刷新总览")
      expect(count("持久记忆总数")).toBe("7")
    },
  )

  it("discards a late overview after leaving it and keeps a failed refresh visibly unavailable", async () => {
    const pending = deferred<JianduMemoryOverview>()
    const api = client()
    api.getOverview.mockReturnValueOnce(pending.promise)
    await mount(api)
    await click("管理当前项目记忆")
    await act(async () => { pending.resolve({ ...overview, totalMemories: 999 }) })
    expect(count("持久记忆总数")).toBeUndefined()
    await click("返回记忆总览")
    expect(count("持久记忆总数")).toBe("7")
    api.getOverview.mockRejectedValueOnce(new Error("/private/runtime/secret"))
    await click("刷新总览")
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("暂时无法加载记忆总览")
    expect(count("持久记忆总数")).toBeUndefined()
    expect(document.body.textContent).not.toContain("/private/runtime/secret")
  })

  it("localizes the overview independently of the current session", async () => {
    await locale.changeLanguage("en-US")
    await mount(client())
    expect(document.querySelector("h2")?.textContent).toBe("Memory overview")
    expect(count("Durable memories")).toBe("7")
    expect(document.body.textContent).toContain("including sessions without a project")
    expect(document.body.textContent).not.toContain("settings.jiandu")
  })
})
