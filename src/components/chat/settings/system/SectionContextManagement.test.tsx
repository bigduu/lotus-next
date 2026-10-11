import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import i18n from "@shared/i18n"
import { SectionContextManagement } from "./SectionContextManagement"
import type {
  ContextManagementStrategy,
  SystemBambooConfig,
  SystemConfigApi,
} from "./useSystemConfig"

const roots: Root[] = []
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

const mount = async (
  config: SystemBambooConfig,
  saveSection: SystemConfigApi["saveSection"]
) => {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(<SectionContextManagement config={config} saveSection={saveSection} />)
  })
  return root
}

const choice = (strategy: ContextManagementStrategy) =>
  document.querySelector<HTMLInputElement>(`input[type="radio"][value="${strategy}"]`)!

const saveButton = () =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "保存"
  )!

const click = async (element: HTMLElement) => {
  await act(async () => {
    element.click()
  })
}

beforeAll(async () => {
  environment.IS_REACT_ACT_ENVIRONMENT = true
  await i18n.changeLanguage("zh-CN")
})

afterAll(() => {
  Reflect.deleteProperty(environment, "IS_REACT_ACT_ENVIRONMENT")
})

afterEach(async () => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.replaceChildren()
  vi.restoreAllMocks()
  await i18n.changeLanguage("zh-CN")
})

describe("SectionContextManagement", () => {
  it("defaults to full summaries and explicitly selects a fail-closed retrieval window", async () => {
    const save = vi.fn(async (patch: SystemBambooConfig) => patch)
    await mount({}, save)

    expect(choice("summary").checked).toBe(true)
    expect(document.querySelectorAll('input[type="radio"]')).toHaveLength(3)
    expect(saveButton().disabled).toBe(true)
    expect(document.body.textContent).toContain("从下一次执行开始生效")

    await click(choice("retrieval_window"))
    expect(choice("summary").checked).toBe(false)
    expect(choice("retrieval_window").checked).toBe(true)
    expect(document.body.textContent).toContain("保存后请新建会话")
    await click(saveButton())

    expect(save).toHaveBeenCalledWith({
      context_management: {
        strategy: "retrieval_window",
        retrieval_window: {
          history_tool_required: true,
          fallback_strategy: "none",
        },
      },
    })
    expect(saveButton().disabled).toBe(true)
  })

  it.each(["summary", "message_summary", "retrieval_window"] as const)(
    "restores the persisted %s strategy without an unsaved change",
    async (strategy) => {
      await mount({ context_management: { strategy } }, vi.fn())

      expect(choice(strategy).checked).toBe(true)
      expect(saveButton().disabled).toBe(true)
    }
  )

  it("saves message summaries and explains the text-only source and retained history", async () => {
    const save = vi.fn(async (patch: SystemBambooConfig) => patch)
    await mount({}, save)

    await click(choice("message_summary"))
    expect(choice("message_summary").checked).toBe(true)
    expect(document.body.textContent).toContain("仅汇总历史用户消息与回复的正文")
    expect(document.body.textContent).toContain("保留当前请求")
    expect(document.body.textContent).toContain("工具调用与结果退出模型上下文")
    expect(document.body.textContent).toContain("原始记录仍保存在会话历史中")
    expect(document.body.textContent).not.toContain("保存后请新建会话")
    await click(saveButton())

    expect(save).toHaveBeenCalledWith({
      context_management: { strategy: "message_summary" },
    })
    expect(saveButton().disabled).toBe(true)
    expect(document.body.textContent).toContain("已保存")
  })

  it("restores full summaries from message summaries", async () => {
    const save = vi.fn(async (patch: SystemBambooConfig) => patch)
    await mount({ context_management: { strategy: "message_summary" } }, save)

    await click(choice("summary"))
    await click(saveButton())

    expect(save).toHaveBeenCalledWith({ context_management: { strategy: "summary" } })
    expect(choice("summary").checked).toBe(true)
    expect(saveButton().disabled).toBe(true)
  })

  it.each([
    ["retrieval_window", {}, "后端未确认检索窗口策略"],
    ["message_summary", {}, "后端未确认消息正文摘要策略"],
    ["message_summary", { context_management: { strategy: "summary" } }, "后端未确认消息正文摘要策略"],
    ["summary", { context_management: { strategy: "retrieval_window" } }, "后端未确认摘要策略"],
  ] as const)(
    "retains the unsaved %s choice when the backend returns %j",
    async (strategy, returned, error) => {
      const save = vi.fn(async () => returned)
      const initial = strategy === "summary" ? "retrieval_window" : "summary"
      await mount({ context_management: { strategy: initial } }, save)

      await click(choice(strategy))
      await click(saveButton())

      expect(choice(strategy).checked).toBe(true)
      expect(saveButton().disabled).toBe(false)
      expect(document.body.textContent).toContain(error)
      expect(document.body.textContent).not.toContain("已保存")
    }
  )

  it("keeps the selected message strategy when an older backend rejects it", async () => {
    const save = vi.fn(async () => {
      throw new Error("Unknown context management strategy: message_summary")
    })
    await mount({}, save)
    await click(choice("message_summary"))
    await click(saveButton())

    expect(choice("message_summary").checked).toBe(true)
    expect(saveButton().disabled).toBe(false)
    expect(document.body.textContent).toContain("Unknown context management strategy")
    expect(document.body.textContent).not.toContain("已保存")
  })

  it("does not accept an unknown backend strategy as confirmation of full summaries", async () => {
    const save = vi.fn(async () => ({
      context_management: { strategy: "future_strategy" },
    } as unknown as SystemBambooConfig))
    await mount({ context_management: { strategy: "message_summary" } }, save)
    await click(choice("summary"))
    await click(saveButton())

    expect(saveButton().disabled).toBe(false)
    expect(document.body.textContent).toContain("后端未确认摘要策略")
    expect(document.body.textContent).not.toContain("已保存")
  })

  it("preserves an unsaved choice when another settings section refreshes the shared config", async () => {
    const save = vi.fn(async (patch: SystemBambooConfig) => patch)
    const root = await mount({}, save)
    await click(choice("message_summary"))

    await act(async () => {
      root.render(<SectionContextManagement config={{ proxy_auth_mode: "auto" }} saveSection={save} />)
    })

    expect(choice("message_summary").checked).toBe(true)
    expect(saveButton().disabled).toBe(false)
  })

  it("localizes all three choices in English without changing the persisted selection", async () => {
    await mount({ context_management: { strategy: "message_summary" } }, vi.fn())
    await act(async () => {
      await i18n.changeLanguage("en-US")
    })

    expect(document.body.textContent).toContain("Full conversation summary")
    expect(document.body.textContent).toContain("Message text summary")
    expect(document.body.textContent).toContain("Exact-history retrieval window")
    expect(document.body.textContent).toContain("Tool calls and results leave the model context")
    expect(choice("message_summary").checked).toBe(true)
  })
})
