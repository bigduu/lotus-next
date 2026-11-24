import { render } from "@solidjs/web"
import { flush } from "solid-js"
import { expect, it } from "vitest"
import i18n, { changeLocale } from "@shared/i18n/runtime"
import { SyncMismatchBreakdown } from "./SyncMismatchBreakdown"

it("refreshes memoized labels with the same backend breakdown object after a locale switch", async () => {
  const previous = i18n.resolvedLanguage === "en-US" ? "en-US" : "zh-CN"
  await changeLocale("zh-CN", { persist: false })
  const host = document.body.appendChild(document.createElement("div"))
  const breakdown = { message_count_mismatch: 1 }
  const dispose = render(() => <SyncMismatchBreakdown breakdown={breakdown} />, host)
  try {
    flush()
    expect(host.textContent).toContain("消息数")
    await changeLocale("en-US", { persist: false })
    flush()
    expect(host.textContent).toContain("Message count")
    expect(host.textContent).not.toContain("消息数")
  } finally {
    dispose()
    host.remove()
    await changeLocale(previous, { persist: false })
  }
})
