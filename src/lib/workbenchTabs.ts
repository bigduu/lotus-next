import type { BrowserTabSummary } from "@services/browser/types"
import type { WorkbenchToolTab } from "@/components/app/RightWorkbench"

export function visibleWorkbenchTabIds(
  openToolTabs: WorkbenchToolTab[],
  browserTabs: BrowserTabSummary[] | null | undefined,
  tabOrder: string[] = [],
): string[] {
  const available = [
    ...openToolTabs.map((tool) => `tool:${tool}`),
    ...(browserTabs ?? []).map((tab) => `browser:${tab.tab_id}`),
  ]
  const availableSet = new Set(available)
  const saved = [...new Set(tabOrder)].filter((key) => availableSet.has(key))
  return [...saved, ...available.filter((key) => !saved.includes(key))]
}
