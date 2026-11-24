import { createEffect } from "solid-js"
import type { ScrollToHistoryEntry } from "../../history/VirtualHistory"

import { findSideChatSourceEntry, type MessageHistoryEntry } from "./historyProjection"

export interface HistoryRevealRequest {
  id: string
  token: number
}

type HistoryRevealOptions = {
  request: () => HistoryRevealRequest | undefined
  sessionId: () => string | null
  entries: () => readonly MessageHistoryEntry[]
  before: () => string | null
  viewport: () => HTMLElement | null
  scrollTo: () => ScrollToHistoryEntry | undefined
  loadEarlier: (sessionId: string) => Promise<void>
  openTurn: (key: string) => void
  onAlign: (active: boolean) => void
  onMissing: () => void
}

function animationFrame(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const cancel = () => {
      cancelAnimationFrame(frame)
      resolve()
    }
    const frame = requestAnimationFrame(() => {
      signal.removeEventListener("abort", cancel)
      resolve()
    })
    signal.addEventListener("abort", cancel, { once: true })
  })
}

function sourceRow(viewport: HTMLElement, entry: MessageHistoryEntry, id: string): HTMLElement | null {
  const key = CSS.escape(entry.key)
  const source = CSS.escape(id)
  return viewport.querySelector<HTMLElement>(`[data-history-entry-key="${key}"] [data-message-row="${source}"]`)
}

/** Wait for a virtual entry to mount and for a folded target to fit within its clip. */
async function alignSource(
  options: HistoryRevealOptions, entry: MessageHistoryEntry, id: string,
  current: () => boolean, signal: AbortSignal,
): Promise<boolean> {
  if (entry.item.kind === "collapsedTurn") options.openTurn(entry.key)
  await animationFrame(signal)
  if (!current()) return false
  options.scrollTo()?.(entry.key, "center")
  // The virtual row can materialize on the next frame, with its disclosure still expanding.
  for (let attempts = 0; attempts < 36; attempts += 1) {
    await animationFrame(signal)
    if (!current()) return false
    const view = options.viewport()
    const row = view && sourceRow(view, entry, id)
    const bounds = row?.getBoundingClientRect()
    if (!view || !row || !bounds?.height || row.closest("[inert]")) continue
    const clip = row.closest(".turn-collapse-content .disclosure-panel-clip")?.getBoundingClientRect()
    if (clip && bounds.bottom > clip.bottom + 1) continue

    const scroller = view.getBoundingClientRect()
    view.scrollTop += bounds.top - scroller.top - (view.clientHeight - bounds.height) / 2
    row.focus({ preventScroll: true })
    if (row.ownerDocument.activeElement === row) return true
  }
  return false
}

export function createHistoryReveal(options: HistoryRevealOptions) {
  let handled: { sessionId: string; token: number } | undefined
  createEffect(() => {
    const request = options.request()
    return [options.sessionId(), request?.id, request?.token] as const
  }, ([sessionId, id, token]) => {
    if (!sessionId || !id || token === undefined || (handled?.sessionId === sessionId && handled.token === token)) return
    const request = new AbortController()
    const current = () => !request.signal.aborted && options.sessionId() === sessionId
      && options.request()?.token === token && options.request()?.id === id

    const reveal = async () => {
      const attempted = new Set<string>()
      while (current()) {
        const entry = findSideChatSourceEntry(options.entries(), id)
        if (entry) {
          options.onAlign(true)
          try { return await alignSource(options, entry, id, current, request.signal) }
          finally { if (current()) options.onAlign(false) }
        }
        const cursor = options.before()
        if (!cursor || attempted.has(cursor)) return false
        attempted.add(cursor)
        await options.loadEarlier(sessionId)
        await animationFrame(request.signal)
      }
      return false
    }
    const finish = (found: boolean) => {
      if (!current()) return
      handled = { sessionId, token }
      if (!found) options.onMissing()
    }
    void reveal().then(finish, () => finish(false))
    return () => {
      request.abort()
      options.onAlign(false)
    }
  })
}
