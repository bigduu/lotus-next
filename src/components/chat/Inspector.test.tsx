import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"
import type { TokenUsage } from "@shared/types/tokenBudget"
import { ContextUsageDetails, PrefixCacheDetails } from "./Inspector"

afterEach(() => {
  document.body.replaceChildren()
})

const renderDetails = (usage?: TokenUsage) => {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(<PrefixCacheDetails usage={usage} />))
  return { container, root }
}

describe("PrefixCacheDetails", () => {
  it("shows the exact provider split and retained-round status", () => {
    const { container, root } = renderDetails({
      systemTokens: 100,
      summaryTokens: 0,
      windowTokens: 900,
      totalTokens: 1_000,
      budgetLimit: 100_000,
      prefixCache: {
        inputTokens: 2_000,
        cacheCreationInputTokens: 500,
        cacheReadInputTokens: 7_500,
        retainedFromPreviousRound: true,
      },
    })

    expect(container.textContent).toContain("Prefix Cache")
    expect(container.textContent).toContain("命中率75%")
    expect(container.textContent).toContain("缓存读取7,500 tokens")
    expect(container.textContent).toContain("Provider 输入10,000 tokens")
    expect(container.textContent).toContain("上一次已完成轮次")

    act(() => root.unmount())
  })

  it("shows raw cache reads without estimating a percentage for old payloads", () => {
    const { container, root } = renderDetails({
      systemTokens: 100,
      summaryTokens: 0,
      windowTokens: 900,
      totalTokens: 1_000,
      budgetLimit: 100_000,
      cacheReadInputTokens: 2_100,
    })

    expect(container.textContent).toContain("缓存读取2,100 tokens")
    expect(container.textContent).toContain("Provider 输入等待完整数据")
    expect(container.textContent).toContain("命中率等待精确数据")
    expect(container.textContent).toContain("上方预估总量口径不同")

    act(() => root.unmount())
  })
})

describe("ContextUsageDetails", () => {
  it("renders every token count with the same value-side unit", () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => {
      root.render(
        <ContextUsageDetails
          usage={{
            systemTokens: 11_472,
            summaryTokens: 123,
            windowTokens: 98_265,
            totalTokens: 109_737,
            maxContextTokens: 1_000_000,
            budgetLimit: 872_000,
            thinkingTokens: 456,
          }}
        />,
      )
    })

    const text = container.textContent ?? ""
    expect(text).toContain("上下文估算")
    expect(text).toContain("预估总量109,737 tokens")
    expect(text).toContain("系统提示词11,472 tokens")
    expect(text).toContain("会话窗口98,265 tokens")
    expect(text).toContain("摘要123 tokens")
    expect(text).toContain("推理456 tokens")
    expect(text).toContain("上下文窗口1,000,000 tokens")
    expect(text).not.toContain("总 tokens")
    expect(text).not.toContain("推理 tokens")

    act(() => root.unmount())
  })
})
