import { describe, expect, it } from "vitest"
import type { Message } from "@shared/types/chatMessages"
import type { SessionExecutionState } from "@shared/store/appStore/slices/executionStateSlice"
import {
  parseBackgroundBashLaunch,
  sessionHasLiveWork,
  sessionHasRunningBackgroundBash,
} from "./sessionBackgroundTasks"

const launch = (bashId: string, overrides: Record<string, unknown> = {}) =>
  JSON.stringify({ bash_id: bashId, command: "npm run build", status: "running", cwd: "/tmp", environment: {}, ...overrides })

const resultMessage = (resultText: string, id = `m-${resultText.length}`): Message =>
  ({ id, type: "tool_result", toolName: "Bash", toolCallId: `c-${id}`, isError: false,
    result: { success: true, result: resultText } }) as unknown as Message

describe("background bash detection", () => {
  it("recognises a launch only when bash_id, running status and a command are all present", () => {
    expect(parseBackgroundBashLaunch(launch("bash-1"))).toBe("bash-1")
    // BashOutput / BashInput reuse `status: "running"` while the shell is alive
    // but carry no command — they must not count as a second launch.
    expect(parseBackgroundBashLaunch(JSON.stringify({ bash_id: "bash-1", status: "running", exit_code: null }))).toBeNull()
    expect(parseBackgroundBashLaunch(JSON.stringify({ bash_id: "bash-1", status: "running", command: "" }))).toBeNull()
    expect(parseBackgroundBashLaunch(JSON.stringify({ bash_id: "", command: "x", status: "running" }))).toBeNull()
    expect(parseBackgroundBashLaunch(JSON.stringify({ bash_id: "bash-1", command: "x", status: "completed" }))).toBeNull()
    expect(parseBackgroundBashLaunch("not json")).toBeNull()
    expect(parseBackgroundBashLaunch(undefined)).toBeNull()
    expect(parseBackgroundBashLaunch(JSON.stringify({ command: "x", status: "running" }))).toBeNull()
  })

  it("reports running until every launched shell has a terminal outcome", () => {
    const messages = [resultMessage(launch("bash-1"), "m1"), resultMessage(launch("bash-2"), "m2")]
    expect(sessionHasRunningBackgroundBash(messages, {})).toBe(true)
    expect(sessionHasRunningBackgroundBash(messages, { "bash-1": { status: "completed", exitCode: 0 } })).toBe(true)
    expect(sessionHasRunningBackgroundBash(messages, {
      "bash-1": { status: "completed", exitCode: 0 },
      "bash-2": { status: "killed", exitCode: null },
    })).toBe(false)
  })

  it("ignores non-result messages and output readbacks when deciding", () => {
    const messages = [
      { id: "a", role: "user", content: "go" } as unknown as Message,
      resultMessage(launch("bash-1"), "m1"),
      resultMessage(launch("bash-1"), "m2"),
      // A readback reuses `status: "running"` without a command: not a launch.
      resultMessage(JSON.stringify({ bash_id: "bash-1", status: "running", output: "tail" }), "m4"),
    ]
    expect(sessionHasRunningBackgroundBash(messages, { "bash-1": { status: "completed", exitCode: 0 } })).toBe(false)
  })

  it("treats transcripts without launches, and missing transcripts, as idle", () => {
    expect(sessionHasRunningBackgroundBash(undefined, {})).toBe(false)
    expect(sessionHasRunningBackgroundBash([], {})).toBe(false)
    const plain = [{ id: "a", role: "assistant", content: "done" } as unknown as Message]
    expect(sessionHasRunningBackgroundBash(plain, {})).toBe(false)
  })

  it("reacts to a terminal outcome without rescanning the transcript", () => {
    const messages = [resultMessage(launch("bash-9"), "m9")]
    expect(sessionHasRunningBackgroundBash(messages, {})).toBe(true)
    expect(sessionHasRunningBackgroundBash(messages, { "bash-9": { status: "completed", exitCode: 0 } })).toBe(false)
    // The cached launch list still works after the outcome flips back.
    expect(sessionHasRunningBackgroundBash(messages, {})).toBe(true)
  })
})

describe("sidebar live-work predicate", () => {
  const execution = (phase: SessionExecutionState["phase"], runningChildren = 0) =>
    ({ phase, children: { byId: {}, runningCount: runningChildren } }) as SessionExecutionState

  it("counts a running background shell while the client holds the session", () => {
    const session = { isRunning: false, messages: [resultMessage(launch("bash-1"), "m1")] }
    expect(sessionHasLiveWork(session, execution("idle"), {})).toBe(true)
    expect(sessionHasLiveWork(session, execution("completed"), {})).toBe(true)
    expect(sessionHasLiveWork(session, execution("idle"), { "bash-1": { status: "completed", exitCode: 0 } })).toBe(false)
  })

  it("counts an active execution phase and live sub-agents", () => {
    expect(sessionHasLiveWork({ isRunning: false, messages: [] }, execution("streaming"), {})).toBe(true)
    expect(sessionHasLiveWork({ isRunning: false, messages: [] }, execution("running_children", 2), {})).toBe(true)
    expect(sessionHasLiveWork({ isRunning: false, messages: [] }, execution("completed"), {})).toBe(false)
    expect(sessionHasLiveWork({ isRunning: false, messages: [] }, execution("idle"), {})).toBe(false)
  })

  it("keeps the backend flag authoritative when it is set", () => {
    expect(sessionHasLiveWork({ isRunning: true, messages: [] }, execution("idle"), {})).toBe(true)
    expect(sessionHasLiveWork({ isRunning: true, messages: [] }, undefined, {})).toBe(true)
  })

  it("does not classify a session this client never engaged with", () => {
    // No execution entry: nothing has been observed for it, so a transcript
    // launch alone must not pulse forever (BashCompleted replays on observe).
    const session = { isRunning: false, messages: [resultMessage(launch("bash-1"), "m1")] }
    expect(sessionHasLiveWork(session, undefined, {})).toBe(false)
  })
})
