import { render } from "@solidjs/web"
import { createSignal, flush } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"
import { changeLocale } from "@shared/i18n/runtime"
import type { PrefixCacheUsage, TokenUsage } from "@shared/types/tokenBudget"
import { ContextUsageRing } from "./ContextUsageRing"

const baseUsage: TokenUsage = {
  totalTokens: 10_000, maxContextTokens: 100_000, budgetLimit: 100_000,
  systemTokens: 500, summaryTokens: 0, windowTokens: 9_500,
}
const prefixCache: PrefixCacheUsage = {
  inputTokens: 2_000, cacheCreationInputTokens: 500, cacheReadInputTokens: 7_500,
}
let cleanup: (() => void) | undefined

afterEach(() => {
  cleanup?.()
  vi.restoreAllMocks()
})

function mount(initial: Partial<TokenUsage> = {}) {
  const host = document.body.appendChild(document.createElement("div"))
  const [usage, setUsage] = createSignal<TokenUsage>({ ...baseUsage, ...initial })
  const onClick = vi.fn()
  const dispose = render(() => <ContextUsageRing usage={usage()} onClick={onClick} />, host)
  flush()
  cleanup = () => { dispose(); host.remove() }
  return {
    badge: () => host.querySelector("[data-prefix-cache]"),
    button: () => host.querySelector("button")!,
    onClick,
    update: (next: Partial<TokenUsage>) => {
      setUsage({ ...baseUsage, ...next })
      flush()
    },
  }
}

it("shows the exact current-session cache rate and opens context details", () => {
  const view = mount({ prefixCache })
  expect(view.badge()?.textContent).toBe("Cache 75%")
  expect(view.button().title).toContain("7,500 cache-read / 10,000 provider input")
  view.button().click()
  expect(view.onClick).toHaveBeenCalledOnce()
})

it("keeps the compact badge rate-focused for compatibility payloads", () => {
  const view = mount()
  expect(view.badge()).toBeNull()
  view.update({ totalTokens: 1_000, cacheReadInputTokens: 1_500 })
  expect(view.badge()?.textContent).toBe("Cache --")
  expect(view.button().title).toContain("未提供命中率分母")
  expect(view.button().title).toContain("1,500 tokens")
})

it("identifies a retained cache value as the previous completed round", () => {
  const view = mount({ prefixCache: {
    inputTokens: 2_000, cacheCreationInputTokens: 0, cacheReadInputTokens: 8_000, retainedFromPreviousRound: true,
  } })
  expect(view.badge()?.textContent).toBe("Cache 80%")
  expect(view.button().title).toContain("上一次已完成轮次")
})

it("localizes the complete tooltip and counts using the selected locale", async () => {
  vi.spyOn(window.navigator, "language", "get").mockReturnValue("fr-FR")
  const view = mount({ prefixCache })
  try {
    await changeLocale("en-US", { persist: false })
    flush()
    expect(view.button().title).toContain("7,500 cache-read / 10,000 provider input")
    expect(view.button().title).not.toMatch(/[（），；]/)
    await changeLocale("zh-CN", { persist: false })
    flush()
    expect(view.button().title).toContain("（")
  } finally {
    await changeLocale("zh-CN", { persist: false })
    flush()
  }
})
