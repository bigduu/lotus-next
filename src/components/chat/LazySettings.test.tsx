import { StrictMode, act, useState } from "react"
import { createPortal } from "react-dom"
import { createRoot, type Root } from "react-dom/client"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { uiText } from "@shared/i18n/ui"
import { useThemeStore } from "@shared/store/themeStore"
import { useExperienceModeStore } from "@shared/store/experienceModeStore"
import { metricsService } from "@services/metrics"

import {
  LazySettings,
  type SettingsModule,
  type SettingsContentProps,
} from "./LazySettings"
import { SettingsContent } from "./Settings"

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(reason: unknown): void
}

interface MountedView {
  container: HTMLDivElement
  root: Root
}

const mountedViews: MountedView[] = []
const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const mount = async (element: React.ReactNode): Promise<MountedView> => {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  const view = { container, root }
  mountedViews.push(view)

  await act(async () => {
    root.render(element)
    await Promise.resolve()
  })
  return view
}

const render = async (view: MountedView, element: React.ReactNode) => {
  await act(async () => {
    view.root.render(element)
    await Promise.resolve()
  })
}

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

const click = async (element: Element | null) => {
  expect(element).not.toBeNull()
  await act(async () => {
    ;(element as HTMLElement).click()
    await Promise.resolve()
  })
}

const pressEscape = async (element: Element | null, options: KeyboardEventInit = {}) => {
  expect(element).not.toBeNull()
  await act(async () => {
    element?.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
      ...options,
    }))
    await Promise.resolve()
  })
}

beforeAll(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => {
  Reflect.deleteProperty(reactActEnvironment, "IS_REACT_ACT_ENVIRONMENT")
})

afterEach(() => {
  for (const view of mountedViews.splice(0)) {
    act(() => view.root.unmount())
    view.container.remove()
  }
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe("LazySettings feature boundary", () => {
  it("loads only on open and keeps the accepted Settings instance across close/reopen", async () => {
    const pending = deferred<SettingsModule>()
    const loadSettings = vi.fn(() => pending.promise)
    const onClose = vi.fn()
    let mounts = 0

    function TestSettings({ tab, onTabChange }: SettingsContentProps) {
      useState(() => {
        mounts += 1
        return undefined
      })
      return (
        <div data-settings>
          <span data-tab>{tab}</span>
          <button onClick={() => onTabChange("metrics")}>指标</button>
        </div>
      )
    }

    const view = await mount(
      <LazySettings open={false} onClose={onClose} loadSettings={loadSettings} />,
    )
    expect(loadSettings).not.toHaveBeenCalled()
    expect(view.container.textContent).toBe("")

    await render(view, <LazySettings open onClose={onClose} loadSettings={loadSettings} />)
    expect(loadSettings).toHaveBeenCalledTimes(1)
    expect(view.container.querySelector('[role="status"]')?.textContent).toContain(
      "正在加载设置",
    )
    const stablePage = view.container.querySelector("main[aria-labelledby]")
    const title = stablePage?.querySelector("h1")
    expect(stablePage).not.toBeNull()
    expect(stablePage?.getAttribute("aria-labelledby")).toBe(title?.id)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(title)

    pending.resolve({ SettingsContent: TestSettings })
    await flush()
    expect(view.container.querySelector("main[aria-labelledby]")).toBe(stablePage)
    expect(document.querySelector("[data-settings]")).not.toBeNull()
    expect(mounts).toBe(1)

    const metricsButton = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "指标",
    )
    await click(metricsButton ?? null)
    expect(document.querySelector("[data-tab]")?.textContent).toBe("metrics")

    await render(
      view,
      <LazySettings open={false} onClose={onClose} loadSettings={loadSettings} />,
    )
    expect(document.querySelector("[data-settings]")).toBeNull()

    await render(view, <LazySettings open onClose={onClose} loadSettings={loadSettings} />)
    expect(loadSettings).toHaveBeenCalledTimes(1)
    expect(mounts).toBe(2)
    expect(document.querySelector("[data-tab]")?.textContent).toBe("metrics")
  })

  it("focuses the page title on entry and provides keyboard and visible return actions", async () => {
    const onClose = vi.fn()
    const loadSettings = vi.fn(async () => ({ SettingsContent: () => <div>settings content</div> }))
    const view = await mount(<LazySettings open={false} onClose={onClose} loadSettings={loadSettings} />)

    await render(view, <LazySettings open onClose={onClose} loadSettings={loadSettings} />)
    await flush()
    const title = view.container.querySelector("h1")
    expect(document.activeElement).toBe(title)

    await pressEscape(title)
    expect(onClose).toHaveBeenCalledTimes(1)
    await click(view.container.querySelector("header button"))
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(view.container.querySelector("header button")?.textContent).toBe("返回聊天")

    await render(view, <LazySettings open={false} onClose={onClose} loadSettings={loadSettings} />)
    const chatButton = document.createElement("button")
    document.body.appendChild(chatButton)
    chatButton.focus()
    await render(view, <LazySettings open onClose={onClose} loadSettings={loadSettings} />)
    expect(document.activeElement).toBe(view.container.querySelector("h1"))
  })

  it("leaves Escape to nested controls and ignores prevented or composing keyboard events", async () => {
    const onClose = vi.fn()
    function NestedControls() {
      return (
        <>
          <input role="combobox" data-combobox />
          <div data-slot="popover-content"><button data-popover>popover</button></div>
          <select data-select><option>selection</option></select>
          <button data-prevented onKeyDown={(event) => event.preventDefault()}>nested handler</button>
          {createPortal(
            <div role="dialog"><button data-nested-dialog>nested dialog</button></div>,
            document.body,
          )}
        </>
      )
    }
    const loadSettings = vi.fn(async () => ({ SettingsContent: NestedControls }))
    const view = await mount(<LazySettings open onClose={onClose} loadSettings={loadSettings} />)
    await flush()

    for (const selector of ["[data-combobox]", "[data-popover]", "[data-select]", "[data-prevented]", "[data-nested-dialog]"]) {
      await pressEscape(document.querySelector(selector))
      expect(onClose).not.toHaveBeenCalled()
    }
    await pressEscape(view.container.querySelector("h1"), { isComposing: true })
    expect(onClose).not.toHaveBeenCalled()
    await pressEscape(view.container.querySelector("h1"))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("contains an import failure and lets the user return to the still-mounted shell", async () => {
    const pending = deferred<SettingsModule>()
    const loadSettings = vi.fn(() => pending.promise)
    vi.spyOn(console, "error").mockImplementation(() => undefined)

    function Host() {
      const [open, setOpen] = useState(true)
      return (
        <StrictMode>
          <div data-chat-shell>chat remains available</div>
          <LazySettings
            open={open}
            onClose={() => setOpen(false)}
            loadSettings={loadSettings}
          />
        </StrictMode>
      )
    }

    const view = await mount(<Host />)
    pending.reject(new Error("chunk unavailable"))
    await flush()

    expect(view.container.querySelector("[data-chat-shell]")?.textContent).toContain("available")
    const failure = document.querySelector('[role="alert"]')
    expect(failure?.textContent).toContain("设置加载失败")
    expect(failure?.textContent).not.toContain("chunk unavailable")

    await click(failure?.querySelector("button") ?? null)
    expect(document.querySelector('[role="alert"]')).toBeNull()
    expect(view.container.querySelector("[data-chat-shell]")).not.toBeNull()
  })
})

describe("Settings page controls", () => {
  it("keeps category navigation usable in both layouts and exposes the selected bubble color", async () => {
    const previousTheme = useThemeStore.getState()
    const previousExperience = useExperienceModeStore.getState()
    vi.spyOn(metricsService, "getSummary").mockRejectedValue(new Error("offline"))
    useThemeStore.setState({ themeMode: "light", themePreference: "light", userMessageColorPreset: "jade" })
    useExperienceModeStore.setState({ mode: "advanced", isAdvanced: true })
    const onTabChange = vi.fn()

    try {
      const view = await mount(<SettingsContent tab="general" onTabChange={onTabChange} />)
      const nav = view.container.querySelector("nav")
      expect([...nav?.querySelectorAll("h3") ?? []].map((heading) => heading.textContent)).toEqual([
        uiText("settings_group_appearance"),
        uiText("settings_group_connections"),
        uiText("settings_group_capabilities"),
        uiText("settings_group_safety"),
      ])
      expect(nav?.querySelector('[aria-current="page"]')?.textContent).toBe(uiText("general_835b700e"))

      await click([...nav?.querySelectorAll("button") ?? []].find((button) => button.textContent === "MCP") ?? null)
      expect(onTabChange).toHaveBeenLastCalledWith("mcp")

      const category = view.container.querySelector<HTMLSelectElement>("#settings-category")
      expect(category?.querySelectorAll("optgroup")).toHaveLength(4)
      expect(category?.options).toHaveLength(17)
      await act(async () => {
        if (category) category.value = "notifications"
        category?.dispatchEvent(new Event("change", { bubbles: true }))
      })
      expect(onTabChange).toHaveBeenLastCalledWith("notifications")

      const blue = [...view.container.querySelectorAll("button")].find((button) => button.textContent === uiText("bubble_blue"))
      expect(blue?.getAttribute("aria-pressed")).toBe("false")
      await click(blue ?? null)
      expect(blue?.getAttribute("aria-pressed")).toBe("true")
      expect(useThemeStore.getState().userMessageColorPreset).toBe("blue")
      expect(view.container.querySelector('input[type="color"]')).not.toBeNull()

      await act(async () => {
        useExperienceModeStore.setState({ mode: "simple", isAdvanced: false })
      })
      expect([...category?.options ?? []].map((option) => option.value)).not.toContain("jiandu")
      expect([...category?.options ?? []].map((option) => option.value)).toContain("providers")
    } finally {
      await act(async () => {
        useThemeStore.setState(previousTheme)
        useExperienceModeStore.setState(previousExperience)
      })
    }
  })
})
