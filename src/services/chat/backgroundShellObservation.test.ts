import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { AgentEvent } from "./AgentService"
import {
  deliverSessionNotification, observeBackgroundShells, stopAllBackgroundShellObservations,
} from "./backgroundShellObservation"

const mocks = vi.hoisted(() => ({
  notify: vi.fn(),
  enabled: vi.fn(),
  canNotify: vi.fn(),
  setBashCompleted: vi.fn(),
  subscribeAgent: vi.fn(),
}))

vi.mock("@/lib/notify", () => ({
  notify: mocks.notify,
  isNotifyEnabled: mocks.enabled,
  notifyPermission: mocks.canNotify,
}))

vi.mock("@shared/store/appStore", () => ({
  useAppStore: { getState: () => ({ backgroundBash: {}, setBashCompleted: mocks.setBashCompleted }) },
}))

vi.mock("./v2Stream", () => ({ subscribeAgent: mocks.subscribeAgent }))

const sessionId = "watched-session"
const completed: AgentEvent = { type: "bash_completed", bash_id: "shell-1", status: "completed", exit_code: 0 }
const notification = (): AgentEvent => ({
  type: "notification", session_id: sessionId, dedup_key: "bash:shell-1",
  category: "background_task_completed", title: "Shell finished", body: "exit 0",
})

function observe() {
  const close = vi.fn()
  mocks.subscribeAgent.mockReturnValue({ close, fresh: true, promise: new Promise<void>(() => {}) })
  observeBackgroundShells(sessionId, ["shell-1"])
  const emit = mocks.subscribeAgent.mock.lastCall![2] as (event: AgentEvent) => void
  return { close, emit }
}

describe("background shell notification handoff", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.enabled.mockReturnValue(true)
    mocks.canNotify.mockReturnValue("granted")
  })

  afterEach(() => {
    stopAllBackgroundShellObservations()
    vi.useRealTimers()
  })

  it("retains the last observer until the actual notification arrives and delivers the frame once", () => {
    const { close, emit } = observe()
    emit(completed)
    expect(mocks.setBashCompleted).toHaveBeenCalledWith("shell-1", "completed", 0)
    expect(close).not.toHaveBeenCalled()
    expect(mocks.notify).not.toHaveBeenCalled()

    emit({ ...notification(), session_id: "other-session" })
    expect(mocks.notify).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()

    const frame = notification()
    deliverSessionNotification(frame)
    emit(frame)
    expect(mocks.notify).toHaveBeenCalledExactlyOnceWith("Shell finished", "exit 0")
    expect(close).toHaveBeenCalledTimes(1)
    vi.runOnlyPendingTimers()
    expect(close).toHaveBeenCalledTimes(1)
  })

  it("expires an observer whose final result receives no matching notification", () => {
    const { close, emit } = observe()
    emit(completed)
    expect(close).not.toHaveBeenCalled()
    vi.runOnlyPendingTimers()
    expect(close).toHaveBeenCalledTimes(1)
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it("keeps a new shell subscribed when it starts during the previous notification wait", () => {
    const { close, emit } = observe()
    emit(completed)
    observeBackgroundShells(sessionId, ["shell-2"])
    vi.runOnlyPendingTimers()
    expect(close).not.toHaveBeenCalled()

    emit(notification())
    expect(mocks.notify).toHaveBeenCalledTimes(1)
    expect(close).not.toHaveBeenCalled()
    emit({ ...completed, bash_id: "shell-2", status: "killed" })
    expect(close).toHaveBeenCalledTimes(1)
  })

  it.each([
    { status: "killed", enabled: true },
    { status: "completed", enabled: false },
  ])("finishes promptly for $status with browser notification enabled=$enabled", ({ status, enabled }) => {
    mocks.enabled.mockReturnValue(enabled)
    const { close, emit } = observe()
    emit({ ...completed, status })
    expect(close).toHaveBeenCalledTimes(1)
    expect(mocks.notify).not.toHaveBeenCalled()
  })
})
