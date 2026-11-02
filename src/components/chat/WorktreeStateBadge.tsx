import { GitBranch, GitMerge } from "lucide-react"
import { uiText } from "@shared/i18n/ui"
import type { CheckoutMergeState } from "@/hooks/useWorktreeMergeStates"

/**
 * The sidebar badge for the Git state of a session's checkout.
 *
 * Conventions, and why each state looks different:
 * - `in_progress`: branch glyph plus a dot, amber. Someone is working here.
 * - `merged`: merge glyph, purple. The work already landed.
 * - `primary` / `unknown`: muted branch glyph, no dot. `unknown` means the
 *   backend could not prove anything, so it must never borrow the merged
 *   styling — local refs cannot see a squash merge.
 *
 * A session with no registered worktree renders nothing; the caller passes no
 * state rather than an unknown one, so no empty slot shifts the row.
 */
export function WorktreeStateBadge({ merge, running }: { merge: CheckoutMergeState; running?: boolean }) {
  const merged = merge.state === "merged"
  const working = merge.state === "in_progress"
  // `primary` is the workspace itself and `unknown` is "cannot tell"; both stay
  // muted so a stale or absent answer never looks like a merge.
  const tone = merged ? "text-primary" : working ? "text-amber-500" : "text-muted-foreground"
  const label = uiText(`worktree_state_${merge.state}`, merge.baseRef ? { base: merge.baseRef } : undefined)
  return (
    <span role="img" aria-label={label} title={label} data-worktree-state={merge.state} className={`relative flex size-4 shrink-0 items-center justify-center ${tone}`}>
      {merged ? <GitMerge className="size-3" aria-hidden="true" /> : <GitBranch className="size-3" aria-hidden="true" />}
      {working ? <span aria-hidden="true" className={`absolute right-0 top-0 size-1 rounded-full bg-amber-500${running ? " animate-pulse" : ""}`} /> : null}
    </span>
  )
}
