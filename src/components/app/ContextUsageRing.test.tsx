import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ContextUsageRing } from "./ContextUsageRing"

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
