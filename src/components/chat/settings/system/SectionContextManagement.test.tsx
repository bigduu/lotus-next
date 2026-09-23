import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { SectionContextManagement } from "./SectionContextManagement"
import type { SystemBambooConfig, SystemConfigApi } from "./useSystemConfig"

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
}

const summarySwitch = () =>
  document.querySelector<HTMLButtonElement>('[role="switch"][aria-label="自动生成上下文摘要"]')!

const saveButton = () =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "保存"
  )!

const click = async (element: HTMLElement) => {
  await act(async () => {
    element.click()
  })
}

beforeAll(() => {
  environment.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => {
  Reflect.deleteProperty(environment, "IS_REACT_ACT_ENVIRONMENT")
})

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe("SectionContextManagement", () => {
  it("defaults to summaries and disables them with a fail-closed retrieval window", async () => {
    const save = vi.fn(async (patch: SystemBambooConfig) => patch)
    await mount({}, save)

    expect(summarySwitch().getAttribute("aria-checked")).toBe("true")
    expect(saveButton().disabled).toBe(true)
    expect(document.body.textContent).toContain("从下一次执行开始生效")

    await click(summarySwitch())
    expect(summarySwitch().getAttribute("aria-checked")).toBe("false")
    expect(document.body.textContent).toContain("保存后请新建会话")
    expect(saveButton().disabled).toBe(false)

    await click(saveButton())
    await vi.waitFor(() => {
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
  })

  it("shows the persisted retrieval-window state and can restore summaries", async () => {
    const save = vi.fn(async (patch: SystemBambooConfig) => patch)
    await mount({ context_management: { strategy: "retrieval_window" } }, save)

    expect(summarySwitch().getAttribute("aria-checked")).toBe("false")
    expect(document.body.textContent).toContain("原始消息仍保存在会话历史中")

    await click(summarySwitch())
    expect(summarySwitch().getAttribute("aria-checked")).toBe("true")
    expect(document.body.textContent).not.toContain("保存后请新建会话")

    await click(saveButton())
    await vi.waitFor(() => {
      expect(save).toHaveBeenCalledWith({
        context_management: { strategy: "summary" },
      })
      expect(saveButton().disabled).toBe(true)
    })
  })

  it("does not report success when the backend drops the retrieval-window strategy", async () => {
    const save = vi.fn(async () => ({}))
    await mount({}, save)

    await click(summarySwitch())
    await click(saveButton())

    await vi.waitFor(() => {
      expect(summarySwitch().getAttribute("aria-checked")).toBe("false")
      expect(saveButton().disabled).toBe(false)
      expect(document.body.textContent).toContain(
        "后端未确认检索窗口策略，配置尚未在当前运行中生效"
      )
      expect(document.body.textContent).not.toContain("已保存")
    })
  })
})
