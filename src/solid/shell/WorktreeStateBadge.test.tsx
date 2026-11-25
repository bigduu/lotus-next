import { render, type JSX } from "@solidjs/web"
import { flush } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"
import type { CheckoutMergeState } from "@/lib/worktreeMergeState"
import type { ChatItem } from "@shared/types/chatMessages"
import { SessionRow } from "./SessionRow"

vi.mock("@lucide/solid", () => {
  const Icon = (props: Pick<JSX.IntrinsicElements["svg"], "class" | "aria-hidden">) =>
    <svg class={props.class} aria-hidden={props["aria-hidden"]} />
  return { AlertCircle: Icon, Check: Icon, Copy: Icon, List: Icon, LoaderCircle: Icon, MoreHorizontal: Icon, Pencil: Icon,
    Pin: Icon, PinOff: Icon, RotateCcw: Icon, Sparkles: Icon, Trash2: Icon, GitBranch: Icon, GitMerge: Icon }
})

// This fixture measures which badge slots the actual row creates. The row's
// interactive menus run through their native primitives in the browser suite.
vi.mock("../ui/dropdown-menu", () => {
  const ignore = () => null
  return { DropdownMenu: ignore, DropdownMenuContent: ignore, DropdownMenuItem: ignore, DropdownMenuSub: ignore,
    DropdownMenuSubContent: ignore, DropdownMenuSubTrigger: ignore, DropdownMenuTrigger: ignore }
})

const cleanups = new Set<() => void>()
afterEach(() => {
  for (const cleanup of cleanups) cleanup()
})

function renderRow(mergeState?: CheckoutMergeState, running = false) {
  const noop = () => {}
  const host = document.body.appendChild(document.createElement("div"))
  const chat = { id: "s1", title: "Worktree session", isRunning: running } as ChatItem
  const dispose = render(() => <SessionRow chat={chat} active={false} unread={false} running={running}
    mergeState={mergeState} onSelect={noop} onRename={noop} onDelete={noop} onClear={noop}
    onTogglePin={noop} onRegenerateTitle={noop} onCopySessionId={noop} />, host)
  flush()
  const cleanup = () => {
    cleanups.delete(cleanup)
    dispose()
    host.remove()
  }
  cleanups.add(cleanup)
  return { host, cleanup }
}

it("renders no badge at all when the session has no registered worktree", () => {
  const { host, cleanup } = renderRow(undefined)
  expect(host.querySelector("[data-worktree-state]")).toBeNull()
  // No reserved space either: the row must not gain an empty icon slot.
  expect(host.querySelectorAll("[role=img]")).toHaveLength(0)
  cleanup()
})

it("marks merged checkouts with the purple merged affordance", () => {
  const { host, cleanup } = renderRow({ state: "merged", baseRef: "origin/dev" })
  const badge = host.querySelector("[data-worktree-state]")!
  expect(badge.getAttribute("data-worktree-state")).toBe("merged")
  expect(badge.className).toContain("text-primary")
  expect(badge.getAttribute("aria-label")).toContain("origin/dev")
  cleanup()
})

it("marks outstanding work amber with a dot, pulsing only while running", () => {
  const idle = renderRow({ state: "in_progress", baseRef: "origin/dev" })
  const idleBadge = idle.host.querySelector("[data-worktree-state]")!
  expect(idleBadge.getAttribute("data-worktree-state")).toBe("in_progress")
  expect(idleBadge.className).toContain("text-amber-500")
  expect(idleBadge.querySelector(".animate-pulse")).toBeNull()
  idle.cleanup()

  const running = renderRow({ state: "in_progress", baseRef: "origin/dev" }, true)
  const runningBadge = running.host.querySelector("[data-worktree-state]")!
  expect(runningBadge.querySelector(".animate-pulse")).not.toBeNull()
  running.cleanup()
})

it("never borrows merged styling for an unknown checkout state", () => {
  const { host, cleanup } = renderRow({ state: "unknown" })
  const badge = host.querySelector("[data-worktree-state]")!
  expect(badge.getAttribute("data-worktree-state")).toBe("unknown")
  expect(badge.className).not.toContain("text-primary")
  expect(badge.className).toContain("text-muted-foreground")
  cleanup()
})
