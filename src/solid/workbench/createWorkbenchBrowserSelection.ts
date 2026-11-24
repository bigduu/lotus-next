import { createEffect, type Accessor } from "solid-js"

import { visibleWorkbenchTabIds } from "@/lib/workbenchTabs"
import type { WorkbenchToolTab } from "@/lib/workbenchTabTypes"
import type { BrowserState } from "@services/browser/types"

import type { createWorkbenchState } from "./createWorkbenchState"

type Restoration = {
  scope: string | null
  version: number
  status: "pending" | "activating" | "complete"
  attempted?: BrowserState
}

/** Restore a surviving browser selection without opening or navigating any page. */
export function createWorkbenchBrowserSelection(options: {
  workbench: ReturnType<typeof createWorkbenchState>
  state: Accessor<BrowserState | null>
  tools: Accessor<WorkbenchToolTab[]>
  selectionVersion: Accessor<number>
  activateTab: (id: string) => Promise<BrowserState | null>
  entryOpen: Accessor<boolean>
  linkPending: Accessor<boolean>
}) {
  const { workbench } = options
  let restoration: Restoration | null = null
  createEffect(
    () => ({ scope: workbench.key(), state: options.state(), saved: workbench.state().browserActiveId }),
    ({ scope, state, saved }) => {
      if (!restoration || restoration.scope !== scope) {
        restoration = { scope, version: options.selectionVersion(), status: "pending" }
      }
      const attempt = restoration
      if (!scope || !state) return
      const visit = workbench.capture()
      const descriptor = workbench.state()
      if (attempt.version !== options.selectionVersion()) attempt.status = "complete"
      const fallback = attempt.status === "pending" && state.tabs?.length === 0 && descriptor.tab === "browser" &&
        descriptor.browserPresent && !state.pending_dialog && !options.entryOpen() && !options.linkPending()
      const tools = options.tools()
      visit.update((current) => {
        const order = state.tabs ? visibleWorkbenchTabIds(tools, state.tabs, current.order) : current.order
        const orderChanged = order.length !== current.order.length || order.some((item, index) => item !== current.order[index])
        const browserPresent = Boolean(state.tabs?.length || (state.url && state.url !== "about:blank"))
        const lastTool = () => tools.find((tool) => order.at(-1) === `tool:${tool}`) ?? null
        if (!orderChanged && browserPresent === current.browserPresent && !fallback) return current
        return { ...current, browserPresent, order, tab: fallback ? lastTool() : current.tab }
      })
      if (attempt.status === "activating") return
      if (attempt.status === "pending" && saved && saved !== state.active_tab_id &&
        state.tabs?.some((tab) => tab.tab_id === saved)) {
        if (state.pending_dialog || attempt.attempted === state) return
        attempt.status = "activating"
        attempt.attempted = state
        void options.activateTab(saved).then((result) => {
          if (restoration !== attempt || !visit.isCurrent() || attempt.version !== options.selectionVersion()) return
          attempt.status = result ? "complete" : "pending"
          if (result) visit.setField("browserActiveId", result.active_tab_id || null)
        })
        return
      }
      attempt.status = "complete"
      visit.setField("browserActiveId", state.active_tab_id || null)
    },
  )
}
