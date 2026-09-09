import { act, type ComponentProps } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import type { PendingQuestion } from "@/hooks/useChat"
import { ApprovalDialog, QuestionDialog } from "./Dialogs"

type QuestionProps = ComponentProps<typeof QuestionDialog>
const roots: Root[] = []
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const permission = (allowed = ["allow_once", "deny_once"]): PendingQuestion => ({
  has_pending_question: true, interaction_kind: "permission", question: "Allow this followup?",
  options: ["Approve", "Deny", "Remember forever"], allow_custom: true, tool_call_id: "followup/a",
  permission_request: { session_id: "supervisor", request_id: "followup/a", request_generation: "generation/a",
    policy_revision: 7, tool_name: "session_control", permission_type: "execute_command", resource: "root-a",
    operation_summary: "Follow up with Root A", allowed_decisions: allowed },
})
const clarification = (callId = "clarification/a"): PendingQuestion => ({
  has_pending_question: true, interaction_kind: "clarification", question: "Which branch?",
  options: ["main", "dev"], allow_custom: true, tool_call_id: callId, permission_request: null,
})
const button = (label: string) => {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((element) => element.textContent?.trim() === label)
  if (!found) throw new Error(`Missing actual dialog button: ${label}`)
  return found
}
const click = (label: string) => act(() => button(label).click())
async function mountQuestion(overrides: Partial<QuestionProps> = {}) {
  const props: QuestionProps = { q: permission(), onAnswer: vi.fn(), onRefresh: vi.fn(), onRetry: vi.fn(), ...overrides }
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  roots.push(root)
  const render = async (next: Partial<QuestionProps> = {}) => {
    Object.assign(props, next)
    await act(async () => root.render(<QuestionDialog {...props} />))
  }
  await render()
  return { props, render }
}
function enterCustom(value: string) {
  const input = document.querySelector("textarea")
  if (!input) throw new Error("Missing actual clarification input")
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!
  act(() => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })) })
}

beforeAll(() => { actEnvironment.IS_REACT_ACT_ENVIRONMENT = true })
afterAll(() => { Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT") })
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.replaceChildren()
})

describe("QuestionDialog actual controls", () => {
  it("shows only typed once choices and never offers custom permission text or remembered grants", async () => {
    const { props } = await mountQuestion({ q: permission(["allow_once", "allow_session", "allow_global", "deny_once"]) })
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain("需要操作授权")
    expect(dialog?.textContent).toContain("Allow this followup?")
    expect([...dialog!.querySelectorAll("button")].map((element) => element.textContent)).toEqual([
      "仅本次允许", "仅本次拒绝", "刷新请求",
    ])
    expect(dialog?.querySelector("textarea")).toBeNull()
    click("仅本次允许"); click("仅本次拒绝")
    expect(props.onAnswer).toHaveBeenNthCalledWith(1, "allow_once")
    expect(props.onAnswer).toHaveBeenNthCalledWith(2, "deny_once")
    expect(props.onRefresh).not.toHaveBeenCalled()
  })

  it("uses only freshly allowed choices after the same generation's policy narrows", async () => {
    const { props, render } = await mountQuestion()
    const narrowed = permission(["deny_once", "deny_session"])
    if (narrowed.interaction_kind === "permission") narrowed.permission_request.policy_revision = 8
    await render({ q: narrowed })
    expect(document.body.textContent).not.toContain("仅本次允许")
    click("仅本次拒绝")
    expect(props.onAnswer).toHaveBeenCalledExactlyOnceWith("deny_once")
  })

  it.each(["loading", "submitting"] as const)("disables real choices and refresh while %s", async (state) => {
    const { props } = await mountQuestion({ [state]: true })
    click("仅本次允许"); click("仅本次拒绝"); click("刷新请求")
    expect(button("仅本次允许").disabled).toBe(true)
    expect(button("仅本次拒绝").disabled).toBe(true)
    expect(button("刷新请求").disabled).toBe(true)
    expect(document.querySelector('[role="status"]')?.textContent).toContain(state === "loading" ? "正在刷新" : "正在提交")
    expect(props.onAnswer).not.toHaveBeenCalled()
    expect(props.onRefresh).not.toHaveBeenCalled()
  })

  it("retains an uncertain error and enables only explicit refresh or exact retry", async () => {
    const { props } = await mountQuestion({ canRetry: true, unavailable: true, error: "提交结果尚未确认" })
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("提交结果尚未确认")
    click("仅本次允许"); click("仅本次拒绝")
    expect(props.onAnswer).not.toHaveBeenCalled()
    click("刷新请求"); click("重试上次提交")
    expect(props.onRefresh).toHaveBeenCalledTimes(1)
    expect(props.onRetry).toHaveBeenCalledTimes(1)
  })

  it("keeps malformed or unavailable interactions closed to decisions while allowing refresh", async () => {
    const { props } = await mountQuestion({ q: permission([]), unavailable: true, error: "无法确认当前请求" })
    expect(document.body.textContent).toContain("没有可用的本次操作选项")
    expect(document.body.textContent).not.toContain("仅本次允许")
    expect(document.body.textContent).not.toContain("重试上次提交")
    click("刷新请求")
    expect(props.onRefresh).toHaveBeenCalledTimes(1)
    expect(props.onAnswer).not.toHaveBeenCalled()
  })

  it("preserves ordinary clarification choices and resets custom text when the question changes", async () => {
    const { props, render } = await mountQuestion({ q: clarification() })
    expect(document.body.textContent).toContain("需要你确认")
    click("main")
    expect(props.onAnswer).toHaveBeenCalledExactlyOnceWith("main")
    enterCustom("  release/next  ")
    click("提交回答")
    expect(props.onAnswer).toHaveBeenLastCalledWith("release/next")
    await render({ q: clarification("clarification/b") })
    expect(document.querySelector("textarea")?.value).toBe("")
    expect(button("提交回答").disabled).toBe(true)
    await render({ q: { ...clarification("clarification/c"), allow_custom: false } })
    expect(document.querySelector("textarea")).toBeNull()
    expect(document.body.textContent).not.toContain("提交回答")
  })

  it("retains a required question when Escape is pressed", async () => {
    const { props } = await mountQuestion()
    act(() => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(props.onAnswer).not.toHaveBeenCalled()
  })

  it("keeps the separate child approval controls and boolean response contract", async () => {
    const onRespond = vi.fn()
    const root = createRoot(document.body.appendChild(document.createElement("div")))
    roots.push(root)
    await act(async () => root.render(<ApprovalDialog a={{ childSessionId: "child/a", requestId: "child/request",
      toolName: "Bash", permission: "execute_command", resource: "echo child" }} onRespond={onRespond} />))
    expect(document.body.textContent).toContain("子代理请求授权")
    const choices = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
    act(() => { choices[0].click(); choices[1].click() })
    expect(onRespond.mock.calls.map(([value]) => value).sort()).toEqual([false, true])
    expect(document.body.textContent).not.toContain("仅本次允许")
  })
})
