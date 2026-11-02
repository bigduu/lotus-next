import { describe, expect, it } from "vitest";
import type { SessionSummary } from "@services/chat/AgentService";
import { selectShouldObserve } from "../../selectors/executionSelectors";
import { applyExecutionEvent, createInitialExecutionState, isTerminalRunStatus } from "./reducer";

const NOW = "2026-11-02T03:00:00.000Z";

const summary = (overrides: Partial<SessionSummary> = {}): SessionSummary => ({
  id: "root-1",
  kind: "root",
  title: "root-1",
  title_version: 0,
  pinned: false,
  root_session_id: "root-1",
  spawn_depth: 0,
  model: "deepseek-flash",
  created_at: "2026-11-02T00:00:00Z",
  updated_at: "2026-11-02T00:00:00Z",
  last_activity_at: "2026-11-02T00:00:00Z",
  message_count: 12,
  has_attachments: false,
  is_running: false,
  ...overrides,
});

/**
 * A Root that delegates yields to its children: the runner stops counting as
 * `Running`, so a summary read carries `is_running: false` while every child
 * still executes. Settling to a terminal phase there also drops the live
 * subscription, which froze the open transcript on its last tool row and read to
 * the user as a hang.
 */
describe("summary reconciliation while children execute", () => {
  const withPhase = (phase: ReturnType<typeof createInitialExecutionState>["phase"]) => ({
    "root-1": { ...createInitialExecutionState("root-1"), phase },
  });

  it("stays busy when the server still counts a running child", () => {
    const next = applyExecutionEvent(
      withPhase("running_tools"),
      {
        type: "applySessionSummary",
        sessionId: "root-1",
        summary: summary({ is_running: false, running_child_count: 2, last_run_status: "suspended" }),
      },
      () => NOW,
    );
    expect(next["root-1"].phase).toBe("running_children");
    // The live subscription is what keeps the transcript advancing.
    expect(selectShouldObserve("root-1")({ executionBySession: next })).toBe(true);
  });

  it("keeps a never-started entry busy instead of settling it to idle", () => {
    const next = applyExecutionEvent(
      withPhase("idle"),
      {
        type: "applySessionSummary",
        sessionId: "root-1",
        summary: summary({ is_running: false, running_child_count: 1 }),
      },
      () => NOW,
    );
    expect(next["root-1"].phase).toBe("running_children");
  });

  it("never overrides a question this session is waiting on", () => {
    const next = applyExecutionEvent(
      withPhase("waiting_user_answer"),
      {
        type: "applySessionSummary",
        sessionId: "root-1",
        summary: summary({ is_running: false, running_child_count: 1, has_pending_question: true }),
      },
      () => NOW,
    );
    expect(next["root-1"].phase).toBe("waiting_user_answer");
  });

  it("settles normally once the last child is gone", () => {
    const next = applyExecutionEvent(
      withPhase("running_children"),
      {
        type: "applySessionSummary",
        sessionId: "root-1",
        summary: summary({ is_running: false, running_child_count: 0, last_run_status: "completed" }),
      },
      () => NOW,
    );
    expect(next["root-1"].phase).toBe("completed");
    expect(selectShouldObserve("root-1")({ executionBySession: next })).toBe(false);
  });

  it("still honours a real terminal status while children are counted", () => {
    // A cancelled Root cannot keep pulsing because a stale child count lingers.
    const next = applyExecutionEvent(
      withPhase("running_children"),
      {
        type: "applySessionSummary",
        sessionId: "root-1",
        summary: summary({ is_running: false, running_child_count: 1, last_run_status: "cancelled" }),
      },
      () => NOW,
    );
    expect(next["root-1"].phase).toBe("cancelled");
  });
});

/**
 * `isTerminalRunStatus` is the shared verdict used by both the reducer above and
 * the pane's delegation predicate. They must agree: while the reducer settled a
 * finished parent, a pane that still called it "running" suppressed its
 * error/diagnostic surface and routed ordinary submissions into the queue.
 */
describe("terminal run status", () => {
  it("treats a real verdict as the end of a run", () => {
    expect(isTerminalRunStatus("completed")).toBe(true);
    expect(isTerminalRunStatus("error")).toBe(true);
    expect(isTerminalRunStatus("cancelled")).toBe(true);
  });

  it("does not treat a wait or an absent verdict as the end of a run", () => {
    // "suspended" is a wait (delegation / background bash), not a finish.
    expect(isTerminalRunStatus("suspended")).toBe(false);
    expect(isTerminalRunStatus("running")).toBe(false);
    expect(isTerminalRunStatus(null)).toBe(false);
    expect(isTerminalRunStatus(undefined)).toBe(false);
  });
});
