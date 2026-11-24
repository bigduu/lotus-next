import { createEffect, createMemo, createSignal } from "solid-js"
import { backendSupports, onBackendFeatures } from "@/lib/backendFeatures"
import { loadWorktreeMergeStates, WORKTREE_MERGE_STATE_FEATURE, type CheckoutMergeState } from "@/lib/worktreeMergeState"
import type { ChatItem } from "@shared/types/chatMessages"
import { createExternalSnapshot } from "../chat/snapshots"

export function createWorktreeMergeStates(chats: () => readonly ChatItem[]) {
  const [states, setStates] = createSignal(new Map<string, CheckoutMergeState>())
  const supported = createExternalSnapshot(onBackendFeatures, () => backendSupports(WORKTREE_MERGE_STATE_FEATURE))
  const request = createMemo(() => {
    if (!supported()) return null
    // Keep updates to titles or runs from refreshing the inventory.
    const projectIds = new Set<string>()
    const sessions: string[] = []
    for (const chat of chats()) {
      const projectId = chat.config?.projectId?.trim()
      if (!projectId) continue
      projectIds.add(projectId)
      sessions.push(JSON.stringify([projectId, chat.id, chat.config?.workspacePath]))
    }
    return projectIds.size ? { projectIds: [...projectIds], key: JSON.stringify(sessions.sort()) } : null
  }, { equals: (previous, next) => previous?.key === next?.key })

  createEffect(request, (wanted) => {
    if (!wanted) {
      setStates(new Map())
      return
    }
    let current = true
    void loadWorktreeMergeStates(wanted.projectIds).then((next) => {
      if (current) setStates(next)
    }).catch(() => {
      if (current) setStates(new Map())
    })
    return () => { current = false }
  })

  return states
}
