import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it } from "vitest"
import { SessionRow } from "./SessionRow"
import type { CheckoutMergeState } from "@/hooks/useWorktreeMergeStates"

const noop = () => {}

function renderRow(mergeState?: CheckoutMergeState, running = false) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  act(() =>
    root.render(
      <SessionRow
        chat={{ id: "s1", title: "Worktree session", isRunning: running }}
        active={false}
        mergeState={mergeState}
        onSelect={noop}
        onRename={noop}
        onDelete={noop}
        onTogglePin={noop}
        onCopySessionId={noop}
      />,
    ),
  )
  return { host, cleanup: () => { act(() => root.unmount()); host.remove() } }
}

it("renders no badge at all when the session has no registered worktree", () => {
  const { host, cleanup } = renderRow(undefined)
  expect(host.querySelector("[data-worktree-state]")).toBeNull()
  // No reserved space either: the row must not gain an empty icon slot.
  expect(host.querySelectorAll("[role=img]")).toHaveLength(0)
  cleanup()
})

it("marks merged checkouts with the purple merged affordance", () => {
  const { host, cleanup } = renderRow({ state: "merged", reason: "is_ancestor", baseRef: "origin/dev" })
  const badge = host.querySelector("[data-worktree-state]")!
  expect(badge.getAttribute("data-worktree-state")).toBe("merged")
  expect(badge.className).toContain("text-primary")
  expect(badge.getAttribute("aria-label")).toContain("origin/dev")
  cleanup()
})

it("marks outstanding work amber with a dot, pulsing only while running", () => {
  const idle = renderRow({ state: "in_progress", reason: "unique_commits", baseRef: "origin/dev" })
  const idleBadge = idle.host.querySelector("[data-worktree-state]")!
  expect(idleBadge.getAttribute("data-worktree-state")).toBe("in_progress")
  expect(idleBadge.className).toContain("text-amber-500")
  expect(idleBadge.querySelector(".animate-pulse")).toBeNull()
  idle.cleanup()

  const running = renderRow({ state: "in_progress", reason: "unique_commits", baseRef: "origin/dev" }, true)
  const runningBadge = running.host.querySelector("[data-worktree-state]")!
  expect(runningBadge.querySelector(".animate-pulse")).not.toBeNull()
  running.cleanup()
})

it("never borrows merged styling for an unknown checkout state", () => {
  const { host, cleanup } = renderRow({ state: "unknown", reason: "no_base_ref" })
  const badge = host.querySelector("[data-worktree-state]")!
  expect(badge.getAttribute("data-worktree-state")).toBe("unknown")
  expect(badge.className).not.toContain("text-primary")
  expect(badge.className).toContain("text-muted-foreground")
  cleanup()
})
