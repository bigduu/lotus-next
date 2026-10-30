import { useEffect, useRef, useState } from "react"
import { apiClient } from "@services/api"

/**
 * Per-checkout merge state, derived by the backend from **local Git refs only**.
 *
 * The backend never fetches and never contacts a forge, so this is exactly as
 * fresh as the last `git fetch`. Local refs cannot observe a squash merge, so a
 * squash-landed branch stays `in_progress` until an authoritative provider
 * answers. The UI therefore never presents `in_progress` as proof of anything
 * and never invents a `merged` state.
 */
export type WorktreeMergeState = "primary" | "merged" | "in_progress" | "unknown"

interface MergeEntry {
  path: string
  state: WorktreeMergeState
  branch: string | null
  head: string
}

/** A resolved checkout state plus the branch it was judged against. */
export interface CheckoutMergeState {
  state: WorktreeMergeState
  /** Integration branch the verdict refers to, e.g. `origin/dev`. */
  baseRef?: string
}

interface MergeRepository {
  base_ref?: string
  worktrees: MergeEntry[]
}

/** Normalised key so a trailing slash never splits one checkout into two rows. */
const key = (path: string) => path.replace(/\/+$/, "")

/**
 * Load merge state for the given Projects in one batch.
 *
 * One request per Project, shared by every row: a sidebar with fifty sessions in
 * one repository must not issue fifty inventories. A failed load is deliberately
 * silent — an unavailable backend means "state unknown", which renders as a
 * muted icon, never as an error banner or a false merge.
 */
export async function loadWorktreeMergeStates(
  projectIds: readonly string[],
): Promise<Map<string, CheckoutMergeState>> {
  const states = new Map<string, CheckoutMergeState>()
  const results = await Promise.all(
    [...new Set(projectIds)].filter(Boolean).map((id) =>
      apiClient
        .get<{ repositories: MergeRepository[] }>(
          `projects/${encodeURIComponent(id)}/worktrees/merge-state`,
        )
        .catch(() => null),
    ),
  )
  for (const result of results) {
    if (!result) continue
    for (const repository of result.repositories) {
      for (const entry of repository.worktrees) {
        const state = entry.state
        states.set(key(entry.path), {
          // Anything the backend added later than this build must stay muted,
          // never borrow a state it might mean something else by.
          state: state === "merged" || state === "in_progress" || state === "primary" ? state : "unknown",
          baseRef: repository.base_ref,
        })
      }
    }
  }
  return states
}

/**
 * The state to paint for one session's checkout.
 *
 * `undefined` means this session does not run in a registered worktree (or the
 * inventory has not loaded yet), so the row must render nothing at all rather
 * than an empty badge that shifts the layout.
 */
export const mergeStateFor = (
  states: Map<string, CheckoutMergeState>,
  workspacePath: string | null | undefined,
): CheckoutMergeState | undefined =>
  workspacePath ? states.get(key(workspacePath)) : undefined

/**
 * Load merge state for the Projects that have a visible session, once each.
 *
 * Repeated renders must not re-request: the loaded set and the previous map are
 * carried across calls so a Project is fetched at most once per page session, and
 * a failed Project is retried on the next call while every row keeps its muted
 * default in the meantime.
 */
export function useWorktreeMergeStates(projectIds: readonly string[]) {
  const [states, setStates] = useState<Map<string, CheckoutMergeState>>(() => new Map())
  const loaded = useRef(new Set<string>())
  // A stable dependency: callers pass a freshly built array on every render.
  const wanted = projectIds.join("\u0000")

  useEffect(() => {
    let alive = true
    const missing = (wanted ? wanted.split("\u0000") : []).filter((id) => id && !loaded.current.has(id))
    if (missing.length) {
      for (const id of missing) loaded.current.add(id)
      void loadWorktreeMergeStates(missing).then((loadedStates) => {
        if (alive) setStates(loadedStates)
      })
    }
    return () => { alive = false }
  }, [wanted])

  return states
}
