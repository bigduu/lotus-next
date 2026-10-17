import { afterEach, expect, it } from "vitest"
import { changeLocale } from "@shared/i18n"
import { sessionMessagePresentation as present } from "./sessionMessagePresentation"

afterEach(async () => { await changeLocale("zh-CN") })
const message = { action: "send_message", child_session_id: "child", message: "follow up" }
it.each([
  ["pending", "等待确认"], ["queued", "队列中"], ["message_queued", "队列中"],
  ["activation_pending", "已保存，等待启动"], ["activation_retry_required", "已保存，启动需重试"],
  ["message_delivered_live", "已送达，已通知当前会话"], ["delivered", "已送达"], ["steering", "插话中"],
  ["completed", "送达状态未确认"], ["running", "送达状态未确认"], ["unknown", "送达状态未确认"],
])("maps explicit %s receipts without conflating admission and delivery", (status, expected) => {
  expect(present("SubAgent", message, { text: JSON.stringify({ status }), isError: false })?.status).toBe(expected)
  expect(present("SubAgent", { intent: "chat", target: "child" }, { text: JSON.stringify({ observed_status: status }), isError: false })?.status).toBe(expected)
})
it("keeps requested interjection distinct from confirmed delivery", () => {
  expect(present("SubAgent", { ...message, interrupt_running: true })).toEqual({ label: "插话", status: "等待确认" })
  for (const text of ["done", "{}", '{"message_id":"m","activation_pending":false}', '{"session_message":{"id":"m"}}']) {
    expect(present("SubAgent", message, { text, isError: false })?.status).toBe("送达状态未确认")
  }
  expect(present("session_message", {}, { text: '{"status":"delivered"}', isError: true })?.status).toBe("发送失败")
})
it("does not reinterpret unrelated tools, actor creation, or actor inspection as sending", () => {
  for (const [tool, params] of [["SubAgent", { action: "create" }], ["SubAgent", { intent: "chat", role: "worker" }], ["SubAgent", { intent: "inspect", target: "child" }], ["Bash", message], ["not_session_message", message]] as const) {
    expect(present(tool, params)).toBeNull()
  }
})
it("localizes message status in English", async () => {
  await changeLocale("en-US")
  expect(present("SubAgent", message, { text: '{"observed_status":"message_queued"}', isError: false })).toEqual({ label: "Send message", status: "In queue" })
})
