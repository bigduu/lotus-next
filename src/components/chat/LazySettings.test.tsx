import { StrictMode, act, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import {
  LazySettings,
  type SettingsModule,
  type SettingsContentProps,
} from "./LazySettings"

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
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "正在加载设置",
    )
    const stableContent = document.querySelector('[data-slot="responsive-dialog-content"]')
    expect(stableContent?.className).toContain("bottom-0")
    expect(stableContent?.className).toContain("h-[88dvh]")
    expect(stableContent?.className).toContain("sm:h-[80vh]")
    expect(stableContent?.className).toContain("sm:max-w-3xl")

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
      await Promise.resolve()
    })
    expect(onClose).toHaveBeenCalledTimes(1)

    pending.resolve({ SettingsContent: TestSettings })
    await flush()
    expect(document.querySelector('[data-slot="responsive-dialog-content"]')).toBe(
      stableContent,
    )
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
