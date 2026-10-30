import { GitBranch, GitMerge } from "lucide-react"
import { uiText } from "@shared/i18n/ui"
import { cn } from "@/lib/utils"
import type { CheckoutMergeState } from "@/hooks/useWorktreeMergeStates"

/**
 * The sidebar badge for the Git state of a session's checkout.
 *
 * Conventions (deliberate, and the reason each state looks different):
 * - `in_progress`: branch glyph plus a dot, amber. Someone is working here.
 * - `merged`: merge glyph, purple. The work already landed and the checkout is
 *   a cleanup candidate.
 * - `primary` / `unknown`: muted branch glyph, no dot. `unknown` is an explicit
 *   "cannot tell" — the backend could not prove anything — so it must never
 *   borrow the merged styling.
 *
 * A session with no registered worktree renders nothing at all; the caller
 * passes no state rather than an unknown one.
 */
export function WorktreeStateBadge({
  merge,
  running,
}: {
  merge: CheckoutMergeState
  /** Pulse the dot only while this session is actually executing. */
  running?: boolean
}) {
  const base = merge.baseRef ? { base: merge.baseRef } : undefined
  if (merge.state === "merged") {
    return (
      <span
        data-worktree-state="merged"
        role="img"
        aria-label={uiText("worktree_state_merged", base)}
        title={uiText("worktree_state_merged", base)}
        className="flex size-4 shrink-0 items-center justify-center text-primary"
      >
        <GitMerge className="size-3.5" aria-hidden="true" />
      </span>
    )
  }
  if (merge.state === "in_progress") {
    return (
      <span
        data-worktree-state="in_progress"
        role="img"
        aria-label={uiText("worktree_state_in_progress", base)}
        title={uiText("worktree_state_in_progress", base)}
        className="relative flex size-4 shrink-0 items-center justify-center text-amber-500"
      >
        <GitBranch className="size-3.5" aria-hidden="true" />
        <span
          aria-hidden="true"
          className={cn(
            "absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-amber-500",
            running && "animate-pulse",
          )}
        />
      </span>
    )
  }
  // `primary` is the workspace itself and `unknown` is "cannot tell"; both stay
  // muted so a stale or absent answer never looks like a merge.
  return (
    <span
      data-worktree-state={merge.state}
      role="img"
      aria-label={uiText(
        merge.state === "primary"
          ? "worktree_state_primary"
          : "worktree_state_unknown",
        base,
      )}
      title={uiText(
        merge.state === "primary"
          ? "worktree_state_primary"
          : "worktree_state_unknown",
        base,
      )}
      className="flex size-4 shrink-0 items-center justify-center text-muted-foreground/60"
    >
      <GitBranch className="size-3.5" aria-hidden="true" />
    </span>
  )
}
