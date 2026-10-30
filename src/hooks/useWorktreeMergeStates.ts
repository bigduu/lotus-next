import { useEffect, useRef, useState } from "react"
import {
  worktreeMergeService,
  type WorktreeMergeState,
} from "@services/workspace/worktreeMergeStateService"

/** A resolved per-checkout state plus the branch it was judged against. */
export interface CheckoutMergeState {
  state: WorktreeMergeState
  reason: string
  /** Integration branch the verdict refers to, e.g. `origin/dev`. */
  baseRef?: string
}

/** Normalised key so a trailing slash never splits one checkout into two rows. */
const key = (path: string) => path.replace(/\/+$/, "")

/**
 * Load worktree merge state for every Project that has a visible session.
 *
 * One request per Project, shared by all rows: a sidebar with fifty sessions in
 * one repository must not issue fifty inventories. Failures are deliberately
 * silent — an unavailable backend means "state unknown", which renders as a
 * muted icon, never as an error banner or a false merge.
 */
export function useWorktreeMergeStates(projectIds: readonly string[]) {
  const [states, setStates] = useState<Map<string, CheckoutMergeState>>(new Map())
  const loaded = useRef(new Set<string>())
  const alive = useRef(true)
  // A stable dependency: callers pass a freshly built array on every render.
  const wanted = projectIds.join("\u0000")

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    const pending = wanted ? wanted.split("\u0000") : []
    const missing = pending.filter((id) => id && !loaded.current.has(id))
    if (!missing.length) return
    for (const id of missing) loaded.current.add(id)

    void Promise.all(
      missing.map((id) =>
        worktreeMergeService
          .state(id)
          .then((result) => ({ id, result, ok: true as const }))
          .catch(() => ({ id, result: null, ok: false as const })),
      ),
    ).then((results) => {
      if (!alive.current) return
      setStates((previous) => {
        const next = new Map(previous)
        for (const { id, result, ok } of results) {
          // A failed load stays unloaded so a later mount can retry it, while
          // leaving every row at its muted default in the meantime.
          if (!ok) {
            loaded.current.delete(id)
            continue
          }
          for (const repository of result.repositories) {
            for (const entry of repository.worktrees) {
              next.set(key(entry.path), {
                state: entry.state,
                reason: entry.reason,
                baseRef: repository.base_ref,
              })
            }
          }
        }
        return next
      })
    })
  }, [wanted])

  return states
}

/**
 * The state to paint for one session's checkout.
 *
 * `undefined` means this session does not run in a registered worktree (or the
 * inventory has not loaded yet), so the row must render nothing at all rather
 * than an empty badge that shifts the layout.
 */
export function mergeStateFor(
  states: Map<string, CheckoutMergeState>,
  workspacePath: string | null | undefined,
): CheckoutMergeState | undefined {
  if (!workspacePath) return undefined
  return states.get(key(workspacePath))
}
