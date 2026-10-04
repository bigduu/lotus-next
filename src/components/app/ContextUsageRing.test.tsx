import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ContextUsageRing } from "./ContextUsageRing"
import { changeLocale } from "@shared/i18n"

afterEach(() => {
  document.body.replaceChildren()
})

describe("ContextUsageRing", () => {
  it("shows the exact current-session cache rate with the compact Cache label", () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => {
      root.render(
        <ContextUsageRing
          totalTokens={10_000}
          maxContextTokens={100_000}
          prefixCache={{
            inputTokens: 2_000,
            cacheCreationInputTokens: 500,
            cacheReadInputTokens: 7_500,
          }}
          onClick={vi.fn()}
        />,
      )
    })

    expect(container.querySelector("[data-prefix-cache]")?.textContent).toBe("Cache 75%")
    expect(container.querySelector("button")?.title).toContain("7,500 cache-read / 10,000 provider input")

    act(() => root.unmount())
  })

  it("keeps the compact badge rate-focused for compatibility payloads", () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => {
      root.render(
        <ContextUsageRing
          totalTokens={1_000}
          maxContextTokens={100_000}
          onClick={vi.fn()}
        />,
      )
    })
    expect(container.querySelector("[data-prefix-cache]")).toBeNull()

    act(() => {
      root.render(
        <ContextUsageRing
          totalTokens={1_000}
          maxContextTokens={100_000}
          cacheReadInputTokens={1_500}
          onClick={vi.fn()}
        />,
      )
    })
    expect(container.querySelector("[data-prefix-cache]")?.textContent).toBe("Cache --")
    expect(container.querySelector("button")?.title).toContain("未提供命中率分母")
    expect(container.querySelector("button")?.title).toContain("1,500 tokens")

    act(() => root.unmount())
  })

  it("identifies a retained cache value as the previous completed round", () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => {
      root.render(
        <ContextUsageRing
          totalTokens={10_000}
          maxContextTokens={100_000}
          prefixCache={{
            inputTokens: 2_000,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 8_000,
            retainedFromPreviousRound: true,
          }}
          onClick={vi.fn()}
        />,
      )
    })

    expect(container.querySelector("[data-prefix-cache]")?.textContent).toBe("Cache 80%")
    expect(container.querySelector("button")?.title).toContain("上一次已完成轮次")

    act(() => root.unmount())
  })
})

it("localizes the complete prefix-cache tooltip and selected-locale counts", async () => {
  vi.spyOn(window.navigator, "language", "get").mockReturnValue("fr-FR")
  const container = document.createElement("div"); document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(<ContextUsageRing totalTokens={10000} maxContextTokens={100000} prefixCache={{ inputTokens: 2000, cacheCreationInputTokens: 500, cacheReadInputTokens: 7500 }} onClick={() => {}} />))
    await act(async () => { await changeLocale("en-US") })
    const title = container.querySelector("button")!.title
    expect(title).toContain("7,500 cache-read / 10,000 provider input")
    expect(title).not.toMatch(/[（），；]/)
    await act(async () => { await changeLocale("zh-CN") })
    expect(container.querySelector("button")!.title).toContain("（")
  } finally {
    act(() => root.unmount())
    vi.restoreAllMocks()
  }
})
