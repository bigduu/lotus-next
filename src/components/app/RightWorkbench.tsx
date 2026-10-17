import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { FocusScope } from "@radix-ui/react-focus-scope"
import { DismissableLayer } from "@radix-ui/react-dismissable-layer"
import { hideOthers } from "aria-hidden"
import { RemoveScroll } from "react-remove-scroll"
import { DragDropProvider } from "@dnd-kit/react"
import { isSortable, useSortable } from "@dnd-kit/react/sortable"
import { ArrowLeft, Bot, FileDiff, Globe2, GripVertical, Plus, SlidersHorizontal, X, ListChecks, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { visibleWorkbenchTabIds } from "@/lib/workbenchTabs"
import { cn } from "@/lib/utils"
import type { BrowserTabSummary } from "@services/browser/types"

function canRestoreFocus(target: HTMLElement | null): target is HTMLElement {
  if (!target?.isConnected || target === document.body || target.matches(":disabled") || target.closest('[hidden], [inert], [aria-hidden="true"]')) return false
  for (let node: HTMLElement | null = target; node; node = node.parentElement) {
    const style = getComputedStyle(node)
    if (style.display === "none" || style.visibility === "hidden") return false
  }
  return true
}

// Work content can be owned by ChatPane and portaled into this DOM subtree.
// Include only explicitly controlled open surfaces, never unrelated body portals.
function workbenchSurfaces(panel: HTMLElement): HTMLElement[] {
  const surfaces = new Set<HTMLElement>([panel])
  for (const surface of surfaces) {
    for (const trigger of surface.querySelectorAll('[aria-expanded="true"][aria-controls]')) {
      for (const id of trigger.getAttribute("aria-controls")!.split(/\s+/)) {
        const controlled = panel.ownerDocument.getElementById(id)
        if (controlled) surfaces.add(controlled)
      }
    }
  }
  return [...surfaces]
}

export type RightWorkbenchTab = "inspector" | "review" | "browser" | "session" | "work"
export type WorkbenchToolTab = Exclude<RightWorkbenchTab, "browser">

const toolEntries = [
  { id: "work", get label() { return uiText("supervisor_work_tab") }, get description() { return uiText("supervisor_work_description") }, icon: ListChecks },
  { id: "inspector", get label() { return uiText("inspector_fc48a7f2") }, get description() { return uiText("view_current_session_ea4cbea5") }, icon: SlidersHorizontal },
  { id: "review", label: "Review", get description() { return uiText("view_file_changes_93cce2ed") }, icon: FileDiff },
  { id: "browser", get label() { return uiText("browser_e19c3b9e") }, get description() { return uiText("enter_a_url_to_open_0d932314") }, icon: Globe2 },
  { id: "session", get label() { return uiText("side_by_side_session_6eced34d") }, get description() { return uiText("open_another_session_28b8469c") }, icon: Bot },
] as const

type VisibleTab =
  | { key: string; kind: "tool"; tool: WorkbenchToolTab }
  | { key: string; kind: "browser"; tab: BrowserTabSummary }

// The outer sortable shell owns selection for both tool and browser tabs.
// Explicit tab data-state below prevents TooltipTrigger from replacing it with open/closed.
const workbenchTabTriggerClass = "h-full min-w-0 flex-1 justify-start bg-transparent px-2 feedback-motion"
const workbenchTabTriggerStyle = { backgroundColor: "transparent", borderColor: "transparent", boxShadow: "none", outlineWidth: 2 }


function SortableWorkbenchTab({
  id,
  index,
  title,
  selected,
  onMove,
  children,
}: {
  id: string
  index: number
  title: string
  selected: boolean
  onMove: (id: string, direction: -1 | 1) => void
  children: ReactNode
}) {
  useUiLocale()
  const { ref, handleRef, isDragging } = useSortable({ id, index })
  return (
    <div
      ref={ref}
      className={cn("flex h-9 min-w-0 flex-none select-none items-center rounded-md border text-muted-foreground feedback-motion switch-feedback", selected ? "border-border bg-background text-foreground shadow-sm" : "border-transparent bg-transparent hover:bg-accent")}
      style={{ maxWidth: 208, opacity: isDragging ? 0.6 : 1 }}
    >
      <button
        ref={handleRef}
        type="button"
        aria-label={uiText("reorder_tab_82ab6e1e", { v0: title })}
        aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
        title={uiText("drag_to_reorder_use_alt_left_right_to_move_bb4c333a")}
        className="flex size-5 shrink-0 items-center justify-center rounded-sm outline-none feedback-motion transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        style={{ marginLeft: 4, touchAction: "none", cursor: "grab" }}
        onKeyDown={(event) => {
          if (!event.altKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return
          event.preventDefault()
          event.stopPropagation()
          onMove(id, event.key === "ArrowLeft" ? -1 : 1)
        }}
      ><GripVertical className="size-3.5" aria-hidden="true" /></button>
      {children}
    </div>
  )
}

export function RightWorkbench({
  activeTab,
  openToolTabs,
  onTabChange,
  onToolClose,
  tabOrder = [],
  onTabReorder,
  onClose,
  inspector,
  review,
  browser,
  session,
  work,
  workEnabled = false,
  sessionTitle,
  docked = false,
  visible = true,
  browserEnabled = true,
  browserSessionAvailable = true,
  browserEntryOpen = false,
  browserTabs,
  activeBrowserTabId,
  browserBusy = false,
  onBrowserActivate,
  onBrowserClose,
  width,
}: {
  activeTab: RightWorkbenchTab | null
  openToolTabs: WorkbenchToolTab[]
  onTabChange: (tab: RightWorkbenchTab | null) => void
  onToolClose: (tab: WorkbenchToolTab) => void
  tabOrder?: string[]
  onTabReorder?: (order: string[]) => void
  onClose: () => void
  inspector: ReactNode
  review: ReactNode
  browser: ReactNode
  session: ReactNode
  work?: ReactNode
  workEnabled?: boolean
  sessionTitle?: string | null
  docked?: boolean
  visible?: boolean
  browserEnabled?: boolean
  browserSessionAvailable?: boolean
  browserEntryOpen?: boolean
  browserTabs?: BrowserTabSummary[] | null
  activeBrowserTabId?: string | null
  browserBusy?: boolean
  onBrowserActivate?: (tabId: string) => void
  onBrowserClose?: (tabId: string) => void
  width?: number
}) {
  useUiLocale()
  const browserValue = !browserEntryOpen && activeBrowserTabId && browserTabs?.some((tab) => tab.tab_id === activeBrowserTabId)
    ? `browser:${activeBrowserTabId}`
    : "browser-entry"
  const selectedValue = activeTab === "browser" ? browserValue : activeTab ?? "launcher"
  const availableTabs: VisibleTab[] = [
    ...openToolTabs.map((tool): VisibleTab => ({ key: `tool:${tool}`, kind: "tool", tool })),
    ...(browserEnabled ? browserTabs ?? [] : []).map((tab): VisibleTab => ({ key: `browser:${tab.tab_id}`, kind: "browser", tab })),
  ]
  const tabByKey = new Map(availableTabs.map((tab) => [tab.key, tab]))
  const orderedTabs = visibleWorkbenchTabIds(openToolTabs, browserEnabled ? browserTabs : null, tabOrder)
    .map((key) => tabByKey.get(key)!)
  const visibleTabIds = orderedTabs.map((tab) => tab.key)
  const tabListRef = useRef<HTMLDivElement>(null)
  const tabMenuTriggerRef = useRef<HTMLButtonElement>(null)
  const addTabTriggerRef = useRef<HTMLButtonElement>(null)
  const closingTab = useRef<string | null>(null)
  const visibleOrderKey = visibleTabIds.join("|")
  useEffect(() => {
    tabListRef.current?.querySelector<HTMLElement>('[role="tab"][data-state="active"]')
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" })
  }, [selectedValue, visibleOrderKey])
  useEffect(() => {
    if (!closingTab.current || visibleTabIds.includes(closingTab.current)) return
    closingTab.current = null
    // Async closes must not steal focus if the user already moved elsewhere.
    if (document.activeElement !== document.body) return
    const next = tabListRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      ?? tabListRef.current?.querySelector<HTMLElement>('[role="tab"]') ?? addTabTriggerRef.current
    next?.focus()
  }, [visibleOrderKey, visibleTabIds])
  const hasTabs = orderedTabs.length > 0
  const [tabMenuOpen, setTabMenuOpen] = useState(false)
  useEffect(() => { if (!hasTabs) setTabMenuOpen(false) }, [hasTabs])
  const moveTab = (id: string, direction: -1 | 1) => {
    const from = visibleTabIds.indexOf(id)
    const to = from + direction
    if (from < 0 || to < 0 || to >= visibleTabIds.length) return
    const next = [...visibleTabIds]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    onTabReorder?.(next)
  }
  const openEntry = (entry: RightWorkbenchTab) => {
    if (entry === "browser" && (!browserEnabled || !browserSessionAvailable || browserBusy)) return
    onTabChange(entry)
  }
  const enabledEntries = toolEntries.filter((entry) => (browserEnabled || entry.id !== "browser") && (workEnabled || entry.id !== "work"))
  const selectValue = (value: string) => {
    if (value.startsWith("browser:")) onBrowserActivate?.(value.slice("browser:".length))
    else if (value !== "launcher" && value !== "browser-entry") onTabChange(value as WorkbenchToolTab)
  }
  const body = (
    <Tabs
      value={selectedValue}
      onValueChange={selectValue}
      className="min-h-0 flex-1 gap-0"
    >
      <div className="flex shrink-0 items-center gap-1 border-b bg-muted/50 px-2 pt-1">
        {hasTabs ? (
          <DragDropProvider onDragEnd={(event) => {
            if (event.canceled || !isSortable(event.operation.source)) return
            const { initialIndex, index } = event.operation.source
            if (initialIndex === index || initialIndex < 0 || index < 0 || index >= visibleTabIds.length) return
            const next = [...visibleTabIds]
            const [moved] = next.splice(initialIndex, 1)
            next.splice(index, 0, moved)
            onTabReorder?.(next)
          }}>
            <TabsList ref={tabListRef} aria-label={uiText("workbench_tabs_e5ddf68a")} className="min-w-0 flex-1 justify-start overflow-x-auto rounded-none bg-transparent p-0">
              {orderedTabs.map((item, index) => {
                if (item.kind === "tool") {
                  const entry = toolEntries.find((candidate) => candidate.id === item.tool)!
                  const Icon = entry.icon
                  const title = item.tool === "session" ? sessionTitle || entry.label : entry.label
                  return (
                    <SortableWorkbenchTab key={item.key} id={item.key} index={index} title={title} selected={activeTab === item.tool} onMove={moveTab}>
                      <Tooltip>
                      <TooltipTrigger asChild>
                      <TabsTrigger data-slot="tabs-trigger" value={item.tool} data-state={activeTab === item.tool ? "active" : "inactive"} style={{ ...workbenchTabTriggerStyle, maxWidth: 176 }} className={workbenchTabTriggerClass}>
                        <Icon className="size-4" />
                        <span className="truncate">{title}</span>
                      </TabsTrigger>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" style={{ maxWidth: "min(24rem, calc(100vw - 2rem))", overflowWrap: "anywhere" }}>{title}</TooltipContent>
                      </Tooltip>
                      <button
                        type="button"
                        aria-label={uiText("close_tab_547d17ad", { v0: entry.label })}
                        title={uiText("close_a70f6657", { v0: entry.label })}
                        className="mr-1 flex size-6 shrink-0 items-center justify-center rounded-sm outline-none feedback-motion transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => { closingTab.current = item.key; onToolClose(item.tool) }}
                      ><X className="size-3.5" aria-hidden="true" /></button>
                    </SortableWorkbenchTab>
                  )
                }
                const title = item.tab.title || item.tab.url || uiText("new_tab_9c5d3416")
                const browserIndex = orderedTabs.slice(0, index).filter((candidate) => candidate.kind === "browser").length + 1
                const isActive = activeTab === "browser" && !browserEntryOpen && item.tab.tab_id === activeBrowserTabId
                return (
                  <SortableWorkbenchTab key={item.key} id={item.key} index={index} title={title} selected={isActive} onMove={moveTab}>
                    <Tooltip>
                    <TooltipTrigger asChild>
                    <TabsTrigger
                      data-slot="tabs-trigger"
                      value={item.key}
                      data-state={isActive ? "active" : "inactive"}
                      aria-label={uiText("browser_tab_bc1120de", { v0: browserIndex, v1: title })}
                      className={workbenchTabTriggerClass}
                      style={workbenchTabTriggerStyle}
                    >
                      <Globe2 className="size-4" />
                      <span className="truncate">{title}</span>
                    </TabsTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" style={{ maxWidth: "min(24rem, calc(100vw - 2rem))", overflowWrap: "anywhere" }}>{title}</TooltipContent>
                    </Tooltip>
                    <button
                      type="button"
                      aria-label={uiText("close_browser_tab_df26cd49", { v0: browserIndex, v1: title })}
                      title={uiText("close_29f8e760", { v0: title })}
                      disabled={browserBusy}
                      className="mr-1 flex size-6 shrink-0 items-center justify-center rounded-sm outline-none feedback-motion transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                      onClick={() => { closingTab.current = item.key; onBrowserClose?.(item.tab.tab_id) }}
                    ><X className="size-3.5" aria-hidden="true" /></button>
                  </SortableWorkbenchTab>
                )
              })}
            </TabsList>
          </DragDropProvider>
        ) : activeTab === "browser" ? (
          <Button size="sm" variant="ghost" className="min-w-0 flex-1 justify-start" onClick={() => onTabChange(null)}>
            <ArrowLeft className="size-4" />{uiText("workbench_c2730bc7")}</Button>
        ) : (
          <span className="min-w-0 flex-1 px-2 text-sm text-muted-foreground">{uiText("workbench_c2730bc7")}</span>
        )}
        <DropdownMenu open={tabMenuOpen} onOpenChange={setTabMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button ref={tabMenuTriggerRef} size="icon" variant="ghost" className="size-8 shrink-0" disabled={!hasTabs}
              aria-label={uiText("workbench_open_tabs")}>
              <ChevronDown className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" aria-label={uiText("workbench_open_tabs")}
            style={{ width: "min(24rem, calc(100vw - 2rem))" }}
            onCloseAutoFocus={(event) => {
              if (tabMenuTriggerRef.current?.disabled) {
                event.preventDefault()
                addTabTriggerRef.current?.focus()
              }
            }}>
            <DropdownMenuRadioGroup value={selectedValue} onValueChange={selectValue}>
              {orderedTabs.map((item, index) => {
                const entry = item.kind === "tool" ? toolEntries.find((candidate) => candidate.id === item.tool)! : null
                const title = item.kind === "browser" ? item.tab.title || item.tab.url || uiText("new_tab_9c5d3416")
                  : item.tool === "session" ? sessionTitle || entry!.label : entry!.label
                return <DropdownMenuRadioItem key={item.key} value={item.kind === "tool" ? item.tool : item.key}
                  aria-label={item.kind === "browser" ? uiText("browser_tab_bc1120de", { v0: orderedTabs.slice(0, index).filter((candidate) => candidate.kind === "browser").length + 1, v1: title }) : undefined}
                  style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>
                  <span className="min-w-0">{title}</span>
                </DropdownMenuRadioItem>
              })}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button ref={addTabTriggerRef} size="icon" variant="ghost" className="size-8 shrink-0" aria-label={uiText("open_workbench_tab_424b2095")}>
              <Plus className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {enabledEntries.map((entry) => {
              const Icon = entry.icon
              return <DropdownMenuItem key={entry.id} disabled={entry.id === "browser" && (!browserEnabled || !browserSessionAvailable || browserBusy)} onSelect={() => openEntry(entry.id)}><Icon />{entry.label}</DropdownMenuItem>
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button size="icon" variant="ghost" aria-label={uiText("collapse_workbench_739b282d")} onClick={onClose}><X /></Button>
      </div>

      {visible && openToolTabs.includes("inspector") ? <TabsContent value="inspector" className="flex min-h-0 overflow-hidden">{inspector}</TabsContent> : null}
      {visible && openToolTabs.includes("review") ? <TabsContent value="review" className="flex min-h-0 overflow-hidden">{review}</TabsContent> : null}
      {workEnabled && openToolTabs.includes("work") ? (
        <TabsContent value="work" forceMount className={cn("min-h-0 overflow-hidden", activeTab === "work" ? "flex" : "hidden")}>
          {work}
        </TabsContent>
      ) : null}
      {visible && browserEnabled ? <TabsContent value={browserValue} className="flex min-h-0 min-w-0 overflow-hidden">{browser}</TabsContent> : null}
      {/* Keep an open root session mounted across tab changes so its draft and
          in-flight send survive; App gates child projection by active tab. */}
      {visible && openToolTabs.includes("session") ? (
        <TabsContent value="session" forceMount className={cn("min-h-0 overflow-hidden", activeTab === "session" ? "flex" : "hidden")}>
          {session}
        </TabsContent>
      ) : null}
      <TabsContent value="launcher" className="flex min-h-0 flex-col items-center justify-center overflow-auto p-6">
        <div className="w-full max-w-md">
          <h2 className="text-base font-medium">{uiText("nothing_open_yet_7202c019")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{uiText("choose_a_tool_or_enter_a_url_to_open_a_page_1d14dfed")}</p>
          <div className="mt-5 flex flex-col gap-2">
            {enabledEntries.map((entry) => {
              const Icon = entry.icon
              const disabled = entry.id === "browser" && (!browserEnabled || !browserSessionAvailable || browserBusy)
              return (
                <button
                  key={entry.id}
                  type="button"
                  disabled={disabled}
                  className="flex min-h-12 w-full items-center gap-3 rounded-lg border bg-muted/50 px-3 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  onClick={() => openEntry(entry.id)}
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1 text-sm">{entry.label}</span>
                  <span className="text-xs text-muted-foreground">{disabled ? uiText("open_a_session_first_fc83ec3a") : entry.description}</span>
                </button>
              )
            })}
          </div>
        </div>
      </TabsContent>
    </Tabs>
  )

  // Keep the real React ancestry stable across breakpoints. Moving a portal
  // under a newly mounted Dialog leaves nested Popover scopes outside that
  // Dialog's lifecycle and can create competing focus traps.
  const panelRef = useRef<HTMLElement>(null)
  const modal = visible && !docked
  const currentMode = useRef({ docked, visible })
  currentMode.current = { docked, visible }
  useEffect(() => {
    const panel = panelRef.current
    if (!modal || !panel) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const fallback = document.querySelector<HTMLElement>('[aria-controls="right-workbench"]')
    // A model/menu portal may already be open when the viewport narrows.
    // Keep that owned surface exposed to assistive technology as well.
    const surfaces = workbenchSurfaces(panel)
    const restoreBackground = hideOthers(surfaces)
    if (!surfaces.some((surface) => surface.contains(document.activeElement))) {
      panel.focus({ preventScroll: true })
    }
    return () => {
      restoreBackground()
      // Resizing back to a docked surface must not move focus out of the editor.
      if (currentMode.current.docked && currentMode.current.visible) return
      const target = [opener, fallback].find(canRestoreFocus)
      target?.focus({ preventScroll: true })
    }
  }, [modal])

  return <>
    {modal ? <div data-slot="dialog-overlay" className="fixed inset-0 z-40 bg-black/50" style={{ pointerEvents: "auto" }} /> : null}
    <RemoveScroll enabled={modal} forwardProps allowPinchZoom>
      <FocusScope asChild loop={modal} trapped={modal}
        onMountAutoFocus={(event) => event.preventDefault()}
        onUnmountAutoFocus={(event) => event.preventDefault()}>
        <DismissableLayer asChild disableOutsidePointerEvents={modal}
          onDismiss={modal ? onClose : undefined}
          onFocusOutside={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => {
            const original = event.detail.originalEvent
            // Radix's React capture flag cannot see a sibling-owned portal.
            // Physical/explicitly owned inside targets must not dismiss the pane.
            const panel = panelRef.current
            const target = original.target
            if (panel && target instanceof Node && workbenchSurfaces(panel).some((surface) => surface.contains(target))) {
              event.preventDefault()
              return
            }
            if (original.button === 2 || (original.button === 0 && original.ctrlKey)) event.preventDefault()
          }}>
          <aside ref={panelRef} id="right-workbench" role={modal ? "dialog" : undefined}
            aria-modal={modal ? true : undefined} aria-label={uiText("workbench_c2730bc7")}
            hidden={!visible}
            className={cn("flex min-h-0 min-w-0 flex-col bg-card", docked ? "shrink-0 border-l" : "fixed inset-y-0 right-0 z-50 border-l shadow-lg")}
            style={{ ...(docked ? { width: width ?? 520 } : { width: "92vw", maxWidth: "42rem" }), display: visible ? undefined : "none" }}>
            {body}
          </aside>
        </DismissableLayer>
      </FocusScope>
    </RemoveScroll>
  </>
}
