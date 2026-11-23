import { useEffect, useState } from "react"
import { backendSupports } from "@/lib/backendFeatures"
import { loadWorktreeMergeStates, WORKTREE_MERGE_STATE_FEATURE, type CheckoutMergeState } from "@/lib/worktreeMergeState"

export { mergeStateFor, type CheckoutMergeState } from "@/lib/worktreeMergeState"

/**
 * Load merge state for the Projects that have a visible session, once each.
 *
 * Repeated renders must not re-request: the loaded set and the previous map are
 * carried across calls so a Project is fetched at most once per page session, and
 * a failed Project is retried on the next call while every row keeps its muted
 * default in the meantime.
 *
 * Gated on the backend capability, so a frontend released ahead of its backend
 * makes no request at all — every row simply renders without a badge.
 */
export function useWorktreeMergeStates(projectIds: readonly string[], refreshKey: string) {
  const [states, setStates] = useState<Map<string, CheckoutMergeState>>(() => new Map())
  // A stable dependency: callers pass a freshly built array on every render.
  const wanted = projectIds.join("\u0000")

  useEffect(() => {
    // Capabilities arrive in the same response that produces these rows, so a
    // row appearing is enough to re-run this once they are known.
    if (!backendSupports(WORKTREE_MERGE_STATE_FEATURE)) return
    let alive = true
    const ids = (wanted ? wanted.split("\u0000") : []).filter(Boolean)
    if (!ids.length) return
    void loadWorktreeMergeStates(ids).then((loadedStates) => {
      if (alive) setStates(loadedStates)
    })
    return () => { alive = false }
    // `refreshKey` is the visible session set. A new session can mean a new
    // worktree in an already-loaded Project, so caching a Project forever would
    // leave that session without a badge until reload. Re-reading when the set
    // changes keeps that cheap: SSE title updates do not alter it.
  }, [wanted, refreshKey])

  return states
}
