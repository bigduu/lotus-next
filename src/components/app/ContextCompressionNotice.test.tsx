import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it } from "vitest"
import { changeLocale } from "@shared/i18n"
import { uiText } from "@shared/i18n/ui"
import type { ContextCompressionFeedback } from "@/lib/contextCompression"
import { ContextCompressionNotice } from "./ContextCompressionNotice"

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.body.appendChild(document.createElement("div"))
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT")
})
const render = async (feedback?: ContextCompressionFeedback | null) => {
  await act(async () => root.render(<ContextCompressionNotice feedback={feedback} />))
}
const cases: { feedback: ContextCompressionFeedback; key: Parameters<typeof uiText>[0] }[] = [
  { feedback: { status: "running" }, key: "context_compression_notice_running" },
  { feedback: { status: "completed", awaitingUsage: true }, key: "context_compression_notice_completed_waiting" },
  { feedback: { status: "completed", awaitingUsage: false }, key: "context_compression_notice_completed" },
  { feedback: { status: "failed", reason: "candidate_plan" }, key: "context_compression_notice_failed_candidate" },
  { feedback: { status: "failed", reason: "postcondition" }, key: "context_compression_notice_failed_postcondition" },
  { feedback: { status: "failed", reason: "other" }, key: "context_compression_notice_failed" },
  { feedback: { status: "deferred", reason: "tool_protocol" }, key: "context_compression_notice_deferred_tool" },
  { feedback: { status: "deferred", reason: "other" }, key: "context_compression_notice_deferred" },
  { feedback: { status: "skipped", reason: "no_model" }, key: "context_compression_notice_skipped_no_model" },
  { feedback: { status: "skipped", reason: "other" }, key: "context_compression_notice_skipped" },
  { feedback: { status: "cancelled" }, key: "context_compression_notice_cancelled" },
  { feedback: { status: "unconfirmed" }, key: "context_compression_notice_unconfirmed" },
]

it.each(["en-US", "zh-CN"] as const)("announces distinct safe outcome messages in %s", async (locale) => {
  await changeLocale(locale)
  const messages: string[] = []
  for (const entry of cases) {
    await render(entry.feedback)
    const notice = host.querySelector('[role="status"]')!
    expect(notice.getAttribute("aria-live")).toBe("polite")
    expect(notice.getAttribute("aria-atomic")).toBe("true")
    expect(notice.textContent).toBe(uiText(entry.key))
    expect(notice.textContent).not.toBe(entry.key)
    expect(notice.textContent).not.toMatch(/40\s*%/)
    messages.push(notice.textContent!)
  }
  expect(new Set(messages).size).toBe(cases.length)
  expect(uiText("context_compression_notice_failed_postcondition")).toContain(locale === "zh-CN" ? "未采用" : "not used")
  expect(uiText("context_compression_notice_completed_waiting")).toContain(locale === "zh-CN" ? "下一次提示词" : "next prompt")
  expect(uiText("context_compression_notice_completed")).toContain(locale === "zh-CN" ? "指令、工具和近期消息" : "instructions, tools, and recent messages")
})

const absentOrUnknown: [string, unknown][] = [
  ["absent", undefined], ["null", null], ["unknown status", { status: "unrecognized" }],
  ["raw status suffix", { status: "failed_candidate_plan:private-diagnostic" }],
  ["unknown reason", { status: "failed", reason: "private-diagnostic" }],
  ["unconfirmed completion shape", { status: "completed" }],
]
it.each(absentOrUnknown)("renders nothing for %s feedback", async (_name, feedback) => {
  await render(feedback as ContextCompressionFeedback | null | undefined)
  expect(host.childElementCount).toBe(0)
  expect(host.textContent).toBe("")
})

it("shows an aria-hidden spinner only while running, with animation limited to motion-safe preference", async () => {
  for (const entry of cases) {
    await render(entry.feedback)
    const spinner = host.querySelector("svg")
    if (entry.feedback.status === "running") {
      expect(spinner?.getAttribute("aria-hidden")).toBe("true")
      expect(spinner?.classList.contains("motion-safe:animate-spin")).toBe(true)
      expect(spinner?.classList.contains("animate-spin")).toBe(false)
    } else {
      expect(spinner).toBeNull()
      expect(host.querySelector('[class*="animate-"]')).toBeNull()
    }
  }
})

it("retains completed feedback on controlled rerenders and clears only when the parent clears it", async () => {
  await render({ status: "running" })
  expect(host.querySelector("svg")).not.toBeNull()
  await render({ status: "completed", awaitingUsage: true })
  expect(host.textContent).toBe(uiText("context_compression_notice_completed_waiting"))
  expect(host.querySelector("svg")).toBeNull()
  await render({ status: "completed", awaitingUsage: true })
  expect(host.textContent).toBe(uiText("context_compression_notice_completed_waiting"))
  await render({ status: "completed", awaitingUsage: false })
  expect(host.textContent).toBe(uiText("context_compression_notice_completed"))
  await render({ status: "failed", reason: "postcondition" })
  expect(host.textContent).toBe(uiText("context_compression_notice_failed_postcondition"))
  await render(null)
  expect(host.childElementCount).toBe(0)
})

it("never includes diagnostic suffixes, summary bodies, model names or paths from extra backend fields", async () => {
  const extra = {
    backendStatus: "failed_postcondition:private-backend-diagnostic",
    summary: "Private summary text <script>must not appear</script>",
    model: "private-summary-model-id", path: "/private/mock/summary.json",
  }
  for (const entry of cases) {
    await render({ ...entry.feedback, ...extra })
    expect(host.textContent).toBe(uiText(entry.key))
    for (const value of Object.values(extra)) expect(host.textContent).not.toContain(value)
    expect(host.querySelector("script")).toBeNull()
  }
})
