import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it } from "vitest"
import { changeLocale } from "@shared/i18n"
import { SyncMismatchBreakdown } from "./SyncMismatchBreakdown"

it("refreshes memoized labels with the same backend breakdown object after a locale switch", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  const breakdown = { message_count_mismatch: 1 }
  try {
    await act(async () => root.render(<SyncMismatchBreakdown breakdown={breakdown} />))
    expect(host.textContent).toContain("消息数")
    await act(async () => { await changeLocale("en-US") })
    expect(host.textContent).toContain("Message count")
    expect(host.textContent).not.toContain("消息数")
  } finally {
    act(() => root.unmount())
    host.remove()
  }
})
