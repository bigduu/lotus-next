import { createSignal, flush, For } from "solid-js"
import { render } from "@solidjs/web"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { createChat, PendingApproval, PendingQuestion } from "./createChat"
import { createRunInteractionTimeline, RunInteractions } from "./RunInteractions"

vi.mock("@kobalte/core/dialog", async () => (await import("../test/compiledKobalte")).compiledKobalte("dialog"))
vi.mock("@lucide/solid", () => {
  const Icon = () => <svg aria-hidden="true" />
  return { AlertTriangle: Icon, ShieldAlert: Icon, X: Icon }
})

type Chat = ReturnType<typeof createChat>

interface InteractionState {
  q?: PendingQuestion
  a?: PendingApproval
  loading?: boolean
  submitting?: boolean
  canRetry?: boolean
  unavailable?: boolean
  error?: string
  childSubmitting?: boolean
  childError?: string
}

const cleanups: (() => void)[] = []

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
function click(label: string) {
  button(label).click()
  flush()
}

function mountInteractions(initial: InteractionState = {}) {
  const [state, setState] = createSignal(initial.a ? initial : { q: permission(), ...initial })
  const props = {
    onAnswer: vi.fn(async (_choice: string) => {}),
    onRefresh: vi.fn(async () => "pending" as const),
    onRetry: vi.fn(async () => {}),
    onRespond: vi.fn(async (_approved: boolean) => {}),
  }
  const compatible = {
    blocked: false, observed: true, loading: false, legacy: false, readError: false,
    report: null, refresh: async () => {},
  } satisfies Chat["executionCompatibility"]
  const ports: Partial<Chat> = {
    currentSessionId: "supervisor",
    messages: [],
    recordedPermission: undefined,
    executionCompatibility: compatible,
    approvalCompatibility: compatible,
    get pendingQuestion() { return state().q ?? null },
    get questionLoading() { return state().loading ?? false },
    get questionSubmitting() { return state().submitting ?? false },
    get questionCanRetry() { return state().canRetry ?? false },
    get questionUnavailable() { return state().unavailable ?? false },
    get questionError() { return state().error ?? null },
    get pendingApproval() { return state().a ?? null },
    get approvalSubmitting() { return state().childSubmitting ?? false },
    get approvalError() { return state().childError ?? null },
    answerQuestion: props.onAnswer,
    refreshQuestion: props.onRefresh,
    retryQuestion: props.onRetry,
    respondApproval: props.onRespond,
  }
  // This harness supplies the interaction view's read model and callback ports.
  const chat = ports as Chat
  const host = document.body.appendChild(document.createElement("div"))
  const dispose = render(() => {
    const entries = createRunInteractionTimeline({ chat, workspace: () => null })
    return <>
      <RunInteractions chat={chat} />
      <For each={entries()} keyed={(entry) => entry.key}>{(entry) => <>{entry().render()}</>}</For>
    </>
  }, host)
  flush()
  cleanups.push(() => { dispose(); host.remove() })
  return {
    props,
    update(next: Partial<InteractionState>) {
      setState((previous) => ({ ...previous, ...next }))
      flush()
    },
  }
}

function enterCustom(value: string) {
  const input = document.querySelector<HTMLTextAreaElement>('[role="dialog"] textarea')
  if (!input) throw new Error("Missing actual clarification input")
  input.value = value
  input.dispatchEvent(new Event("input", { bubbles: true }))
  flush()
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  document.body.replaceChildren()
})

describe("Run interaction controls", () => {
  it("shows one-time choices when the Session grant lacks an exact matcher", () => {
    const { props } = mountInteractions({ q: permission(["allow_once", "allow_session", "allow_global", "deny_once"]) })
    const dialog = document.querySelector('[data-approval-presentation]')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(dialog?.textContent).toContain("需要操作授权")
    expect(dialog?.textContent).toContain("Allow this followup?")
    expect([...dialog!.querySelectorAll("button")].map((element) => element.textContent)).toEqual([
      "仅本次拒绝", "仅本次允许", "刷新请求",
    ])
    expect(dialog?.querySelector("textarea")).toBeNull()
    click("仅本次允许")
    click("仅本次拒绝")
    expect(props.onAnswer).toHaveBeenNthCalledWith(1, "allow_once")
    expect(props.onAnswer).toHaveBeenNthCalledWith(2, "deny_once")
    expect(props.onRefresh).not.toHaveBeenCalled()
  })

  it("offers a Session grant only when the pending contract advertises the exact resource", () => {
    const q = permission(["allow_once", "allow_session", "allow_global", "deny_once"])
    if (q.interaction_kind !== "permission") throw new Error("Missing permission fixture")
    q.permission_request.suggested_matchers = [{ id: "exact_resource", kind: "exact_resource" }]
    const { props, update } = mountInteractions({ q })
    click("本会话临时允许此资源")
    expect(props.onAnswer).toHaveBeenCalledExactlyOnceWith("allow_session")
    update({ q: permission() })
    expect(document.body.textContent).not.toContain("本会话临时允许此资源")
  })

  it("uses only freshly allowed choices after the same generation's policy narrows", () => {
    const { props, update } = mountInteractions()
    const narrowed = permission(["deny_once", "deny_session"])
    if (narrowed.interaction_kind === "permission") narrowed.permission_request.policy_revision = 8
    update({ q: narrowed })
    expect(document.body.textContent).not.toContain("仅本次允许")
    click("仅本次拒绝")
    expect(props.onAnswer).toHaveBeenCalledExactlyOnceWith("deny_once")
  })

  it.each(["loading", "submitting"] as const)("disables real choices and refresh while %s", async (state) => {
    const { props } = mountInteractions({ [state]: true })
    click("仅本次允许")
    click("仅本次拒绝")
    click("刷新请求")
    expect(button("仅本次允许").disabled).toBe(true)
    expect(button("仅本次拒绝").disabled).toBe(true)
    expect(button("刷新请求").disabled).toBe(true)
    expect(document.querySelector('[role="status"]')?.textContent).toContain(state === "loading" ? "正在刷新" : "正在提交")
    expect(props.onAnswer).not.toHaveBeenCalled()
    expect(props.onRefresh).not.toHaveBeenCalled()
  })

  it("retains an uncertain error and enables only explicit refresh or exact retry", () => {
    const { props } = mountInteractions({ canRetry: true, unavailable: true, error: "提交结果尚未确认" })
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("提交结果尚未确认")
    click("仅本次允许")
    click("仅本次拒绝")
    expect(props.onAnswer).not.toHaveBeenCalled()
    click("刷新请求")
    click("重试上次提交")
    expect(props.onRefresh).toHaveBeenCalledTimes(1)
    expect(props.onRetry).toHaveBeenCalledTimes(1)
  })

  it("keeps malformed or unavailable interactions closed to decisions while allowing refresh", () => {
    const { props } = mountInteractions({ q: permission([]), unavailable: true, error: "无法确认当前请求" })
    expect(document.body.textContent).toContain("没有可用的本次操作选项")
    expect(document.body.textContent).not.toContain("仅本次允许")
    expect(document.body.textContent).not.toContain("重试上次提交")
    click("刷新请求")
    expect(props.onRefresh).toHaveBeenCalledTimes(1)
    expect(props.onAnswer).not.toHaveBeenCalled()
  })

  it("preserves ordinary clarification choices and resets custom text when the question changes", () => {
    const { props, update } = mountInteractions({ q: clarification() })
    expect(document.body.textContent).toContain("需要你确认")
    click("main")
    expect(props.onAnswer).toHaveBeenCalledExactlyOnceWith("main")
    enterCustom("  release/next  ")
    click("提交回答")
    expect(props.onAnswer).toHaveBeenLastCalledWith("release/next")
    update({ q: clarification("clarification/b") })
    expect(document.querySelector("textarea")?.value).toBe("")
    expect(button("提交回答").disabled).toBe(true)
    update({ q: { ...clarification("clarification/c"), allow_custom: false } })
    expect(document.querySelector("textarea")).toBeNull()
    expect(document.body.textContent).not.toContain("提交回答")
  })

  it("retains a required question when Escape is pressed", async () => {
    const { props } = mountInteractions({ q: clarification() })
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')?.contains(document.activeElement)).toBe(true))
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
    flush()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(props.onAnswer).not.toHaveBeenCalled()
  })

  it("opens typed approvals without focusing a decision and consumes repeated or composing Enter", () => {
    const composer = document.body.appendChild(document.createElement("textarea"))
    composer.focus()
    const { props, update } = mountInteractions()
    expect(document.activeElement).toBe(composer)
    const allow = button("仅本次允许")
    for (const init of [{ repeat: true }, { isComposing: true }]) {
      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...init })
      allow.dispatchEvent(event)
      flush()
      expect(event.defaultPrevented).toBe(true)
    }
    expect(props.onAnswer).not.toHaveBeenCalled()
    const next = permission()
    if (next.interaction_kind === "permission") next.permission_request.request_generation = "generation/b"
    update({ q: next })
    expect(document.activeElement).toBe(composer)
    click("仅本次允许")
    expect(props.onAnswer).toHaveBeenCalledExactlyOnceWith("allow_once")
  })

  it("retains child approval submission status and error without an automatic decision", () => {
    const a = { childSessionId: "child/a", requestId: "child/request", toolName: "Write" }
    const { props, update } = mountInteractions({ a, childSubmitting: true })
    expect(document.querySelector('[role="status"]')?.textContent).toContain("正在提交")
    const choices = [...document.querySelectorAll<HTMLButtonElement>('[data-approval-presentation] button')]
    expect(choices).toHaveLength(2)
    expect(choices.every((choice) => choice.disabled)).toBe(true)
    choices.forEach((choice) => choice.click())
    flush()
    expect(props.onRespond).not.toHaveBeenCalled()

    update({ childSubmitting: false, childError: "提交结果尚未确认" })
    expect(document.querySelector('[role="status"]')).toBeNull()
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("提交结果尚未确认")
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(props.onRespond).not.toHaveBeenCalled()
    document.querySelector<HTMLButtonElement>('[data-approval-presentation] button')!.click()
    flush()
    expect(props.onRespond).toHaveBeenCalledExactlyOnceWith(false)
  })

  it("keeps the separate child approval controls and boolean response contract", () => {
    const { props } = mountInteractions({ a: { childSessionId: "child/a", requestId: "child/request",
      toolName: "Bash", permission: "execute_command", resource: "echo child" } })
    expect(document.body.textContent).toContain("子代理请求授权")
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    const choices = [...document.querySelectorAll<HTMLButtonElement>('[data-approval-presentation] button')]
    const repeated = new KeyboardEvent("keydown", { key: "Enter", repeat: true, bubbles: true, cancelable: true })
    choices[1].dispatchEvent(repeated)
    flush()
    expect(repeated.defaultPrevented).toBe(true)
    expect(props.onRespond).not.toHaveBeenCalled()
    choices.forEach((choice) => choice.click())
    flush()
    expect(props.onRespond.mock.calls.map(([value]) => value).sort()).toEqual([false, true])
    expect(document.body.textContent).not.toContain("仅本次允许")
  })
})
