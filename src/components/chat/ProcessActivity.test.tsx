import { act, useState, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { uiText } from "@shared/i18n/ui"
import { extractProcessBrief, ProcessActivity } from "./ProcessActivity"

const views: { container: HTMLDivElement; root: Root }[] = []
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeAll(() => { reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true })
afterAll(() => { Reflect.deleteProperty(reactActEnvironment, "IS_REACT_ACT_ENVIRONMENT") })
afterEach(() => {
  for (const { container, root } of views.splice(0)) {
    act(() => root.unmount())
    container.remove()
  }
  vi.restoreAllMocks()
})

async function mount(element: ReactNode) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  views.push({ container, root })
  await act(async () => { root.render(element) })
  return { container, root }
}

describe("extractProcessBrief", () => {
  it("uses the newest real sentence and removes Markdown formatting", () => {
    expect(extractProcessBrief("## Earlier plan\n- **Check** the API.\n> Latest [connection](https://example.test) is `ready`."))
      .toBe("Latest connection is ready.")
    expect(extractProcessBrief("第一步检查配置。现在验证**最终结果**，保留 `run_tests`。"))
      .toBe("现在验证最终结果，保留 run_tests。")
    expect(extractProcessBrief("Earlier step. Verify `Map<T>` now."))
      .toBe("Verify Map<T> now.")
    expect(extractProcessBrief("Previous result.\n  > - [x] **Latest result** is confirmed."))
      .toBe("Latest result is confirmed.")
  })

  it("keeps a Unicode-safe 72-character limit and marks a truncated excerpt", () => {
    const result = extractProcessBrief(`Earlier. ${"检".repeat(74)}🔍`)
    expect(Array.from(result)).toHaveLength(72)
    expect(result).toBe(`${"检".repeat(71)}…`)
    expect(extractProcessBrief("检查🔍验证🔎完成", 5)).toBe("检查🔍验…")
    expect(extractProcessBrief(`${"🔍".repeat(1024)}x`)).toBe(`${"🔍".repeat(71)}…`)
    expect(extractProcessBrief(" \n---\n```\n``` ")).toBe("")
    expect(extractProcessBrief(undefined)).toBe("")
  })
})

describe("ProcessActivity", () => {
  it("keeps the running step visible, then settles it into the inspectable fold", async () => {
    const animations: { resolve: () => void; cancel: ReturnType<typeof vi.fn>; node: HTMLElement }[] = []
    vi.stubGlobal("matchMedia", () => ({ matches: false }))
    const originalAnimate = HTMLElement.prototype.animate
    HTMLElement.prototype.animate = vi.fn(function (this: HTMLElement) {
      let resolve!: () => void
      const finished = new Promise<void>((done) => { resolve = done })
      const cancel = vi.fn()
      animations.push({ resolve, cancel, node: this })
      return { finished, cancel } as unknown as Animation
    })
    try {
      const { container, root } = await mount(
        <ProcessActivity active preview={{ key: "read", running: true, content: <span>Reading app.ts</span> }}>full read result</ProcessActivity>,
      )
      expect(container.querySelector("[data-process-current]")?.textContent).toBe("Reading app.ts")
      expect(container.querySelector<HTMLDivElement>("[data-process-content]")?.hidden).toBe(true)
      await act(async () => {
        root.render(<ProcessActivity active thinking preview={{ key: "read", running: false, content: <span>Read app.ts</span> }}>full read result</ProcessActivity>)
      })
      expect(container.querySelector("[data-process-current]")).toBeNull()
      expect(container.querySelector("[data-process-handoff]")?.textContent).toBe("Read app.ts")
      expect(container.querySelector("[data-process-shimmer]")?.textContent).toBe(uiText("thinking_64088d8c"))
      const handoff = animations.find((animation) => animation.node.hasAttribute("data-process-handoff"))!
      await act(async () => { handoff.resolve(); await Promise.resolve() })
      expect(container.querySelector("[data-process-handoff]")).toBeNull()
      await act(async () => { container.querySelector<HTMLButtonElement>("[data-process-toggle]")!.click() })
      expect(container.querySelector<HTMLDivElement>("[data-process-content]")?.hidden).toBe(false)
      expect(container.querySelector("[data-process-content]")?.textContent).toBe("full read result")
    } finally {
      HTMLElement.prototype.animate = originalAnimate
      vi.unstubAllGlobals()
    }
  })

  it("archives completed steps immediately when motion is reduced", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }))
    const animate = vi.fn()
    const originalAnimate = HTMLElement.prototype.animate
    HTMLElement.prototype.animate = animate
    try {
      const { container, root } = await mount(
        <ProcessActivity active preview={{ key: "run", running: true, content: "Running tests" }}>test result</ProcessActivity>,
      )
      await act(async () => {
        root.render(<ProcessActivity active thinking preview={{ key: "run", running: false, content: "Tests passed" }}>test result</ProcessActivity>)
      })
      expect(container.querySelector("[data-process-current]")).toBeNull()
      expect(container.querySelector("[data-process-handoff]")).toBeNull()
      expect(animate).not.toHaveBeenCalled()
      expect(container.querySelector("[data-process-content]")?.textContent).toBe("test result")
    } finally {
      HTMLElement.prototype.animate = originalAnimate
      vi.unstubAllGlobals()
    }
  })

  it("shows a concrete status without offering an empty disclosure", async () => {
    const onOpenChange = vi.fn()
    const { container } = await mount(
      <ProcessActivity active hasDetails={false} status="Preparing context" open onOpenChange={onOpenChange}>
        <div>no inspectable content</div>
      </ProcessActivity>,
    )
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Preparing context")
    expect(container.querySelector("button")).toBeNull()
    expect(container.querySelector("[data-process-content]")).toBeNull()
    expect(container.textContent).not.toContain("no inspectable content")
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it("starts collapsed and preserves the complete mounted content across disclosure changes", async () => {
    let mounts = 0
    const fullReasoning = "First plan.\n**Now check the complete output.**"
    function FullContent() {
      useState(() => { mounts += 1; return undefined })
      return <div>{fullReasoning}<button>inspect tool output</button></div>
    }
    const { container } = await mount(<ProcessActivity reasoning={fullReasoning}><FullContent /></ProcessActivity>)
    const button = container.querySelector<HTMLButtonElement>("[data-process-toggle]")!
    const content = container.querySelector<HTMLDivElement>("[data-process-content]")!
    expect(button.tagName).toBe("BUTTON")
    expect(button.type).toBe("button")
    expect(button.getAttribute("aria-expanded")).toBe("false")
    expect(button.getAttribute("aria-controls")).toBe(content.id)
    expect(content.hidden).toBe(true)
    expect(content.textContent).toContain(fullReasoning)
    expect(container.querySelector("[data-process-brief]")?.textContent).toBe("Now check the complete output.")

    await act(async () => { button.click() })
    expect(button.getAttribute("aria-expanded")).toBe("true")
    expect(content.hidden).toBe(false)
    await act(async () => { button.click() })
    expect(content.hidden).toBe(true)
    expect(mounts).toBe(1)
  })

  it("requests controlled changes without overriding its owner's open state", async () => {
    const onOpenChange = vi.fn()
    const onToggle = vi.fn()
    const { container, root } = await mount(
      <ProcessActivity open={false} onOpenChange={onOpenChange} onToggle={onToggle}>full process</ProcessActivity>,
    )
    const button = container.querySelector<HTMLButtonElement>("[data-process-toggle]")!
    await act(async () => { button.click() })
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(true)
    expect(onToggle).toHaveBeenCalledExactlyOnceWith(true)
    expect(button.getAttribute("aria-expanded")).toBe("false")

    await act(async () => {
      root.render(<ProcessActivity open onOpenChange={onOpenChange} onToggle={onToggle}>full process</ProcessActivity>)
    })
    expect(container.querySelector<HTMLDivElement>("[data-process-content]")?.hidden).toBe(false)
    await act(async () => { button.click() })
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
    expect(button.getAttribute("aria-expanded")).toBe("true")
  })

  it("shows current reasoning with a fixed accessible label and sweeps only while actively thinking", async () => {
    const { container, root } = await mount(
      <ProcessActivity active thinking reasoning="Earlier. Checking the newest state." toolCallCount={2}>full content</ProcessActivity>,
    )
    const button = container.querySelector<HTMLButtonElement>("[data-process-toggle]")!
    const brief = container.querySelector("[data-process-brief]")!
    expect(button.getAttribute("aria-label")).toBe(uiText("thinking_64088d8c"))
    expect(brief.textContent).toBe("Checking the newest state.")
    expect(container.querySelector("[data-process-shimmer]")).not.toBeNull()

    await act(async () => {
      root.render(<ProcessActivity active reasoning="Earlier. Checking the newest state." status="Inspecting tool output" toolCallCount={2}>full content</ProcessActivity>)
    })
    expect(brief.textContent).toBe("Inspecting tool output")
    expect(button.getAttribute("aria-label")).toBe(uiText("process_activity"))
    expect(container.querySelector("[data-process-shimmer]")).toBeNull()

    await act(async () => {
      root.render(<ProcessActivity thinking reasoning="Earlier. Latest saved conclusion.">full content</ProcessActivity>)
    })
    expect(brief.textContent).toBe("Latest saved conclusion.")
    expect(button.getAttribute("aria-label")).toBe(uiText("process_activity"))
    expect(container.querySelector("[data-process-shimmer]")).toBeNull()
  })

  it("uses tool count or the supplied label when no reasoning excerpt is available", async () => {
    const { container, root } = await mount(<ProcessActivity active toolCallCount={3}>tools</ProcessActivity>)
    expect(container.querySelector("[data-process-brief]")?.textContent).toBe(uiText("process_tool_count", { count: 3 }))
    await act(async () => { root.render(<ProcessActivity label="Checking configuration">tools</ProcessActivity>) })
    expect(container.querySelector("[data-process-brief]")?.textContent).toBe("Checking configuration")
    expect(container.querySelector("[data-process-toggle]")?.getAttribute("aria-label")).toBe("Checking configuration")
    expect(container.querySelector("[data-process-content]")?.getAttribute("aria-label")).toBe("Checking configuration")
  })
})
