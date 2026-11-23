import { useTabsContext, type TabsContextValue } from "@kobalte/core/tabs"
import { createContext, createEffect, createMemo, createSignal, For, onSettled, Show, useContext, type Accessor } from "solid-js"
import { Dynamic, type JSX } from "@solidjs/web"
import { DragDropManager } from "@dnd-kit/dom"
import { isSortable, Sortable } from "@dnd-kit/dom/sortable"
import { hideOthers } from "aria-hidden"
import { ArrowLeft, Bot, ChevronDown, FileDiff, Globe2, GripVertical, ListChecks, MessageSquare, Plus, SlidersHorizontal, Workflow, X } from "@lucide/solid"

import { workbenchDragCancellation } from "@/lib/workbench/workbenchDragCancellation"
import { workbenchSensors } from "@/lib/workbench/workbenchSensors"
import { cn } from "@/lib/utils"
import type { RightWorkbenchTab, WorkbenchToolTab } from "@/lib/workbenchTabTypes"
import { visibleWorkbenchTabIds } from "@/lib/workbenchTabs"
import type { BrowserTabSummary } from "@services/browser/types"

import { createUiText } from "../shell/uiText"
import { Button } from "../ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger,
} from "../ui/dropdown-menu"
import { DialogLayerMount } from "../ui/layer-scope"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip"

export type { RightWorkbenchTab, WorkbenchToolTab } from "@/lib/workbenchTabTypes"

export interface WorkbenchTabDrag {
  isActive: () => boolean
  getSourceId: () => string | null
  cancel: () => void
}

type DragRef = { current: WorkbenchTabDrag | null }
type UiText = ReturnType<typeof createUiText>
type WorkbenchTextKey = Parameters<UiText>[0]

interface WorkbenchSurfaceProps {
  children: JSX.Element
  onClose: () => void
  focusScopeKey?: string | null
  getCurrentFocusScope?: () => string | null
  docked?: boolean
  expanded?: boolean
  visible?: boolean
  pageVisible?: boolean
  interactionSuspended?: boolean
  tabDragRef?: DragRef
  width?: number | string
}

export interface RightWorkbenchProps extends Omit<WorkbenchSurfaceProps, "children"> {
  activeTab: RightWorkbenchTab | null
  openToolTabs: WorkbenchToolTab[]
  onTabChange: (tab: RightWorkbenchTab | null) => void
  onToolClose: (tab: WorkbenchToolTab) => void
  tabOrder?: string[]
  onTabReorder?: (order: string[]) => void
  inspector: JSX.Element
  review: JSX.Element
  browser: JSX.Element
  subagents: JSX.Element
  sideChat?: JSX.Element
  sideChatEnabled?: boolean
  taskDag?: JSX.Element
  work?: JSX.Element
  workEnabled?: boolean
  browserEnabled?: boolean
  browserSessionAvailable?: boolean
  browserEntryOpen?: boolean
  browserTabs?: BrowserTabSummary[] | null
  activeBrowserTabId?: string | null
  browserBusy?: boolean
  onBrowserActivate?: (tabId: string) => void
  onBrowserClose?: (tabId: string) => void
}

const toolEntries = [
  { id: "side-chat", label: "side_chat_title", description: "side_chat_description", icon: MessageSquare },
  { id: "work", label: "supervisor_work_tab", description: "supervisor_work_description", icon: ListChecks },
  { id: "inspector", label: "inspector_fc48a7f2", description: "view_current_session_ea4cbea5", icon: SlidersHorizontal },
  { id: "review", label: null, description: "view_file_changes_93cce2ed", icon: FileDiff },
  { id: "browser", label: "browser_e19c3b9e", description: "enter_a_url_to_open_0d932314", icon: Globe2 },
  { id: "subagents", label: "subagent_workbench_tab", description: "subagent_workbench_description", icon: Bot },
  { id: "task-dag", label: "session_task_dag_title", description: "session_task_dag_description", icon: Workflow },
] as const satisfies readonly {
  id: RightWorkbenchTab
  label: WorkbenchTextKey | null
  description: WorkbenchTextKey
  icon: typeof Bot
}[]

const nameOf = (entry: typeof toolEntries[number], text: UiText) => entry.label ? text(entry.label) : "Review"
const entryFor = (id: RightWorkbenchTab) => toolEntries.find((entry) => entry.id === id)!
const triggerClass = "h-full min-w-0 flex-1 justify-start bg-transparent px-2 feedback-motion"
const triggerStyle = { "background-color": "transparent", "border-color": "transparent", "box-shadow": "none", "outline-width": "2px" }
const closeClass = "mr-1 flex size-6 shrink-0 items-center justify-center rounded-sm outline-none feedback-motion transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"

const WorkbenchScope = createContext<{
  drag: Accessor<DragRef>
  escape: (event: KeyboardEvent) => void
}>()

function canRestoreFocus(target: HTMLElement | null): target is HTMLElement {
  if (!target?.isConnected || target === document.body || target === document.documentElement || target.matches(":disabled") || target.closest('[hidden], [inert], [aria-hidden="true"]')) return false
  for (let node: HTMLElement | null = target; node; node = node.parentElement) {
    const style = getComputedStyle(node)
    if (style.display === "none" || style.visibility === "hidden") return false
  }
  return true
}

export function RightWorkbenchSurface(props: WorkbenchSurfaceProps) {
  const text = createUiText()
  const internalDrag: DragRef = { current: null }
  const drag = () => props.tabDragRef ?? internalDrag
  const [panel, setPanel] = createSignal<HTMLElement | undefined>(undefined, { ownedWrite: true })
  const visible = () => props.visible !== false
  const pageVisible = () => props.pageVisible !== false
  const modal = () => visible() && pageVisible() && !props.docked
  let focusGeneration = 0

  createEffect(() => [visible(), pageVisible(), props.focusScopeKey] as const, () => {
    const active = drag()
    return () => { active.current?.cancel() }
  })
  createEffect(() => props.interactionSuspended, (suspended) => {
    if (suspended) drag().current?.cancel()
  })

  createEffect(
    () => ({ modal: modal(), element: panel(), scope: props.focusScopeKey, currentScope: props.getCurrentFocusScope }),
    ({ modal, element, scope, currentScope }) => {
      if (!modal || !element) return
      const generation = ++focusGeneration
      const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
      const fallback = document.querySelector<HTMLElement>('[aria-controls="right-workbench"]')
      if (!element.contains(document.activeElement)) element.focus({ preventScroll: true })

      return () => {
        // Moving to a docked pane or hiding the chat page must leave the current focus alone.
        if (!pageVisible() || (props.docked && visible())) return
        requestAnimationFrame(() => {
          if (focusGeneration !== generation || (currentScope && currentScope() !== scope) || modalElementVisible()) return
          const active = document.activeElement
          if (active instanceof HTMLElement && !element.contains(active) && canRestoreFocus(active)) return
          [opener, fallback].find(canRestoreFocus)?.focus({ preventScroll: true })
        })
      }
    },
  )

  createEffect(
    () => [modal() && !props.interactionSuspended, panel()] as const,
    ([active, element]) => {
      if (!active || !element) return
      const externalDialog = (target: Element | null) => {
        const dialog = target?.closest('[aria-modal="true"]')
        return dialog && dialog !== element && !element.contains(dialog)
      }
      const restoreBackground = hideOthers(element)
      const onTab = (event: KeyboardEvent) => {
        if (event.defaultPrevented || event.key !== "Tab") return
        const current = document.activeElement
        if (externalDialog(current)) return
        const stops = [...element.querySelectorAll<HTMLElement>(
          'a[href], button, input, select, textarea, iframe, summary, [contenteditable="true"], [tabindex]',
        )].filter((target) => target.tabIndex >= 0 && canRestoreFocus(target))
        const first = stops[0]
        const last = stops.at(-1)
        if (!first || !last || !element.contains(current) || current === element ||
          (event.shiftKey ? current === first : current === last)) {
          event.preventDefault()
          const target = (event.shiftKey ? last : first) ?? element
          target.focus({ preventScroll: true })
        }
      }
      const onFocus = (event: FocusEvent) => {
        const target = event.target
        if (target instanceof Element && !element.contains(target) && !externalDialog(target)) {
          element.focus({ preventScroll: true })
        }
      }
      document.addEventListener("keydown", onTab)
      document.addEventListener("focusin", onFocus)
      return () => {
        document.removeEventListener("keydown", onTab)
        document.removeEventListener("focusin", onFocus)
        restoreBackground()
      }
    },
  )

  const modalElementVisible = () => visible() && pageVisible() && panel()?.isConnected && panel()?.matches('[aria-modal="true"]')

  const onEscape = (event: KeyboardEvent) => {
    if (!modal() || props.interactionSuspended || event.key !== "Escape" || event.defaultPrevented || event.isComposing || drag().current?.isActive()) return
    // Nested selector content consumes its own Escape before this stable surface.
    if (event.target instanceof Element &&
      event.target.closest('[role=listbox], [role=menu], [data-slot=popover-content], [aria-expanded="true"][aria-haspopup="listbox"]')) return
    event.preventDefault()
    props.onClose()
  }

  return (
    <WorkbenchScope value={{ drag, escape: onEscape }}>
      <Show when={modal()}>
        <div
          data-slot="dialog-overlay"
          class="fixed inset-0 z-40 touch-none bg-black/50"
          style={{ "pointer-events": "auto" }}
          onClick={(event) => {
            if (!event.defaultPrevented && event.button === 0 && !event.ctrlKey) props.onClose()
          }}
        />
      </Show>
      <aside
          ref={setPanel}
          tabindex={-1}
          id="right-workbench"
          role={modal() ? "dialog" : "complementary"}
          aria-modal={modal() ? "true" : undefined}
          aria-label={text("workbench_c2730bc7")}
          hidden={!visible()}
          class={cn("flex min-h-0 min-w-0 flex-col bg-card", props.docked ? "shrink-0 border-l" : "fixed inset-y-0 right-0 z-50 shadow-lg md:border-l")}
          style={{
            width: props.docked ? typeof props.width === "string" ? props.width : `${props.width ?? 520}px` : "100%",
            "max-width": props.docked || props.expanded ? undefined : "min(56rem, max(calc(100vw - 3rem), 48rem))",
            display: visible() ? undefined : "none",
          }}
          onKeyDown={onEscape}
        >
          <DialogLayerMount value={panel}>{props.children}</DialogLayerMount>
      </aside>
    </WorkbenchScope>
  )
}

function SortableWorkbenchTab(props: {
  id: string
  index: number
  title: string
  selected: boolean
  manager?: DragDropManager
  dragging: boolean
  disabled: boolean
  onMove: (id: string, direction: -1 | 1) => void
  text: UiText
  children: JSX.Element
}) {
  const [node, setNode] = createSignal<HTMLDivElement | undefined>(undefined, { ownedWrite: true })
  const [handle, setHandle] = createSignal<HTMLButtonElement | undefined>(undefined, { ownedWrite: true })
  const [sortable, setSortable] = createSignal<Sortable>()

  createEffect(
    () => ({ manager: props.manager, node: node(), handle: handle() }),
    ({ manager, node, handle }) => {
      if (!manager || !node || !handle) return
      const instance = new Sortable({ id: props.id, index: props.index, element: node, handle, disabled: props.disabled }, manager)
      setSortable(instance)
      return () => {
        instance.destroy()
        setSortable(undefined)
      }
    },
  )
  createEffect(() => [sortable(), props.index] as const, ([instance, index]) => {
    if (instance) instance.index = index
  })
  // Suspending interaction can cancel an optimistic DOM move. Keep its live
  // index until the drag manager restores the original order.
  createEffect(() => [sortable(), props.disabled] as const, ([instance, disabled]) => {
    if (instance) instance.disabled = disabled
  })

  return (
    <div
      ref={setNode}
      class={cn("flex h-9 min-w-0 flex-none select-none items-center rounded-md border text-muted-foreground feedback-motion switch-feedback", props.selected ? "border-border bg-background text-foreground shadow-sm" : "border-transparent bg-transparent hover:bg-accent")}
      style={{ "max-width": "208px", opacity: props.dragging ? 0.6 : 1 }}
    >
      <button
        ref={setHandle}
        type="button"
        aria-label={props.text("reorder_tab_82ab6e1e", { v0: props.title })}
        data-workbench-tab-handle={props.id}
        aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
        title={props.text("drag_to_reorder_use_alt_left_right_to_move_bb4c333a")}
        class="flex size-5 shrink-0 items-center justify-center rounded-sm outline-none feedback-motion transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        style={{ "margin-left": "4px", "touch-action": "none", cursor: "grab" }}
        onFocusIn={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (props.disabled || !event.altKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return
          event.preventDefault()
          event.stopPropagation()
          props.onMove(props.id, event.key === "ArrowLeft" ? -1 : 1)
        }}
      ><GripVertical class="size-3.5" aria-hidden="true" /></button>
      {props.children}
    </div>
  )
}

export function RightWorkbenchContent(props: RightWorkbenchProps) {
  const text = createUiText()
  const scope = useContext(WorkbenchScope)
  const fallbackDrag: DragRef = { current: null }
  const drag = () => props.tabDragRef ?? scope?.drag() ?? fallbackDrag
  const [manager, setManager] = createSignal<DragDropManager>()
  const [draggingId, setDraggingId] = createSignal<string>()
  const [tabMenuOpen, setTabMenuOpen] = createSignal(false)
  const [tabList, setTabList] = createSignal<HTMLDivElement | undefined>(undefined, { ownedWrite: true })
  let tabMenuTrigger: HTMLButtonElement | undefined
  let addTabTrigger: HTMLButtonElement | undefined
  let closingTab: string | null = null
  let tabsContext: TabsContextValue | undefined
  const RegisterTabsContext = () => {
    tabsContext = useTabsContext()
    return null
  }

  const visible = () => props.visible !== false
  const browserEnabled = () => props.browserEnabled !== false
  const browserUnavailable = () => !browserEnabled() || props.browserSessionAvailable === false || props.browserBusy
  const browserTabs = () => browserEnabled() ? props.browserTabs ?? [] : []
  const browserValue = () => !props.browserEntryOpen && props.activeBrowserTabId && browserTabs().some((tab) => tab.tab_id === props.activeBrowserTabId)
    ? `browser:${props.activeBrowserTabId}` : "browser-entry"
  const selectedValue = () => props.activeTab === "browser" ? browserValue() : props.activeTab ?? "launcher"
  const virtualTabSelected = () => selectedValue() === "launcher" || selectedValue() === "browser-entry"
  const visibleTabIds = createMemo(() => visibleWorkbenchTabIds(props.openToolTabs, browserTabs(), props.tabOrder))
  const hasTabs = () => visibleTabIds().length > 0
  const enabledEntries = createMemo(() => toolEntries.filter((entry) =>
    (browserEnabled() || entry.id !== "browser") &&
    (props.workEnabled || entry.id !== "work") &&
    (props.sideChatEnabled || entry.id !== "side-chat") &&
    (props.taskDag != null || entry.id !== "task-dag"),
  ))

  const reorder = (from: number, to: number) => {
    const current = visibleTabIds()
    if (from === to || from < 0 || to < 0 || from >= current.length || to >= current.length) return
    const next = [...current]
    next.splice(to, 0, next.splice(from, 1)[0]!)
    props.onTabReorder?.(next)
  }
  const moveTab = (id: string, direction: -1 | 1) => {
    const from = visibleTabIds().indexOf(id)
    reorder(from, from + direction)
  }
  const selectValue = (value: string) => {
    if (props.interactionSuspended || drag().current?.isActive()) return
    // A newly opened tab becomes the controlled value before its trigger joins
    // Kobalte's collection. Ignore the primitive's transient first-tab fallback.
    if (!tabsContext?.listState().collection().getItem(selectedValue())) return
    if (value.startsWith("browser:")) props.onBrowserActivate?.(value.slice("browser:".length))
    else if (value !== "launcher" && value !== "browser-entry") props.onTabChange(value as WorkbenchToolTab)
  }
  const openEntry = (entry: RightWorkbenchTab) => {
    if (entry !== "browser" || !browserUnavailable()) props.onTabChange(entry)
  }
  const tabData = (key: string) => {
    const isBrowser = key.startsWith("browser:")
    const browserId = isBrowser ? key.slice("browser:".length) : undefined
    const tab = browserTabs().find((candidate) => candidate.tab_id === browserId)
    const value = isBrowser ? key : key.slice("tool:".length) as WorkbenchToolTab
    const entry = isBrowser ? entryFor("browser") : entryFor(value as WorkbenchToolTab)
    const title = isBrowser ? tab?.title || tab?.url || text("new_tab_9c5d3416") : nameOf(entry, text)
    const browserIndex = isBrowser ? visibleTabIds().slice(0, visibleTabIds().indexOf(key)).filter((id) => id.startsWith("browser:")).length + 1 : undefined
    return { isBrowser, browserId, browserIndex, value, title, icon: entry.icon }
  }

  onSettled(() => {
    const engine = new DragDropManager({ sensors: workbenchSensors })
    const unregisterStart = engine.monitor.addEventListener("dragstart", (event) => {
      if (event.operation.source) setDraggingId(String(event.operation.source.id))
    })
    const unregisterEnd = engine.monitor.addEventListener("dragend", (event) => {
      setDraggingId(undefined)
      const source = event.operation.source
      if (!event.canceled && isSortable(source)) reorder(source.initialIndex, source.index)
    })
    const isActive = () => !engine.dragOperation.controller?.signal.aborted &&
      (engine.dragOperation.status.initializing || engine.dragOperation.status.dragging)
    const cancellation = workbenchDragCancellation(engine, isActive)
    const reference = drag()
    const registration: WorkbenchTabDrag = {
      isActive,
      getSourceId: () => isActive() && engine.dragOperation.sourceIdentifier != null ? String(engine.dragOperation.sourceIdentifier) : null,
      cancel: cancellation.cancel,
    }
    // Drag feedback can move the focused handle out of the pane. Cancel from
    // the keyboard while the manager still owns the gesture, then restore only
    // that handle. Navigation cancellation leaves focus to the new surface.
    const cancelFromKeyboard = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || !registration.isActive()) return
      const handle = engine.dragOperation.source?.handle
      event.preventDefault()
      event.stopImmediatePropagation()
      registration.cancel()
      if (!(handle instanceof HTMLElement)) return

      if (canRestoreFocus(handle)) handle.focus({ preventScroll: true })
      requestAnimationFrame(() => {
        if (reference.current === registration && document.activeElement === document.body && canRestoreFocus(handle)) {
          handle.focus({ preventScroll: true })
        }
      })
    }
    window.addEventListener("keydown", cancelFromKeyboard, true)
    reference.current = registration
    setManager(engine)
    return () => {
      window.removeEventListener("keydown", cancelFromKeyboard, true)
      registration.cancel()
      cancellation.dispose()
      unregisterStart()
      unregisterEnd()
      if (reference.current === registration) reference.current = null
      engine.destroy()
    }
  })

  createEffect(() => ({ key: selectedValue(), ids: visibleTabIds(), element: tabList() }), ({ ids, element }) => {
    element?.querySelector<HTMLElement>('[role="tab"][data-state="active"]')?.scrollIntoView({ block: "nearest", inline: "nearest" })
    if (!closingTab || ids.includes(closingTab)) return
    closingTab = null
    if (document.activeElement !== document.body) return
    const next = element?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]:not([aria-hidden="true"])')
      ?? element?.querySelector<HTMLElement>('[role="tab"]:not([aria-hidden="true"])') ?? addTabTrigger
    next?.focus()
  })
  createEffect(hasTabs, (available) => {
    if (!available) setTabMenuOpen(false)
  })

  return (
    <Tabs value={selectedValue()} onValueChange={selectValue} class="min-h-0 flex-1 gap-0">
      <RegisterTabsContext />
      <div class="flex shrink-0 items-center gap-1 border-b bg-muted/50 px-2 pt-1">
        <Show when={hasTabs()} fallback={
          <Show when={props.activeTab === "browser"} fallback={<span class="min-w-0 flex-1 px-2 text-sm text-muted-foreground">{text("workbench_c2730bc7")}</span>}>
            <Button size="sm" variant="ghost" class="min-w-0 flex-1 justify-start" onClick={() => props.onTabChange(null)}>
              <ArrowLeft class="size-4" />{text("workbench_c2730bc7")}
            </Button>
          </Show>
        }>
          <TabsList
            ref={setTabList}
            aria-label={text("workbench_tabs_e5ddf68a")}
            class="min-w-0 flex-1 justify-start overflow-x-auto rounded-none bg-transparent p-0"
            // Kobalte handles Escape even when it cannot clear the tab selection.
            onKeyDown={scope?.escape}
          >
            <For each={visibleTabIds()}>{(key, index) => {
              const tab = createMemo(() => tabData(key))
              const active = () => selectedValue() === tab().value
              return (
                <SortableWorkbenchTab
                  id={key} index={index()} title={tab().title} selected={active()} manager={manager()}
                  dragging={draggingId() === key} disabled={props.interactionSuspended || !visible() || props.pageVisible === false}
                  onMove={moveTab} text={text}
                >
                  <Tooltip placement="bottom">
                    <TooltipTrigger
                      as={TabsTrigger} value={tab().value} data-slot="tabs-trigger" data-state={active() ? "active" : "inactive"}
                      aria-label={tab().isBrowser ? text("browser_tab_bc1120de", { v0: tab().browserIndex, v1: tab().title }) : undefined}
                      style={tab().isBrowser ? triggerStyle : { ...triggerStyle, "max-width": "176px" }}
                      class={triggerClass}
                      {...(virtualTabSelected() ? { tabindex: index() === 0 ? 0 : -1 } : {})}
                    >
                      <Dynamic component={tab().icon} class="size-4" aria-hidden="true" />
                      <span class="truncate">{tab().title}</span>
                    </TooltipTrigger>
                    <TooltipContent style={{ "max-width": "min(24rem, calc(100vw - 2rem))", "overflow-wrap": "anywhere" }}>{tab().title}</TooltipContent>
                  </Tooltip>
                  <button
                    type="button"
                    aria-label={tab().isBrowser ? text("close_browser_tab_df26cd49", { v0: tab().browserIndex, v1: tab().title }) : text("close_tab_547d17ad", { v0: tab().title })}
                    title={tab().isBrowser ? text("close_29f8e760", { v0: tab().title }) : text("close_a70f6657", { v0: tab().title })}
                    disabled={tab().isBrowser && props.browserBusy}
                    class={closeClass}
                    onFocusIn={(event) => event.stopPropagation()}
                    onClick={() => {
                      const current = tab()
                      closingTab = key
                      if (current.browserId) props.onBrowserClose?.(current.browserId)
                      else props.onToolClose(current.value as WorkbenchToolTab)
                    }}
                  ><X class="size-3.5" aria-hidden="true" /></button>
                </SortableWorkbenchTab>
              )
            }}</For>
            {/* Kobalte normalizes unknown values to the first real tab. Register
                untabbable placeholders so an intentionally open launcher or
                browser entry does not change the caller's selected tool. */}
            <TabsTrigger value="launcher" aria-hidden="true" style={{ display: "none" }} hidden disabled />
            <TabsTrigger value="browser-entry" aria-hidden="true" style={{ display: "none" }} hidden disabled />
          </TabsList>
        </Show>
        <DropdownMenu open={tabMenuOpen()} onOpenChange={setTabMenuOpen} placement="bottom-end">
          <DropdownMenuTrigger
            as={Button} ref={(node: HTMLButtonElement) => { tabMenuTrigger = node }} size="icon" variant="ghost" class="size-8 shrink-0"
            disabled={!hasTabs()} aria-label={text("workbench_open_tabs")}
          ><ChevronDown class="size-4" /></DropdownMenuTrigger>
          <DropdownMenuContent
            aria-label={text("workbench_open_tabs")} style={{ width: "min(24rem, calc(100vw - 2rem))" }}
            onCloseAutoFocus={(event: Event) => {
              if (tabMenuTrigger?.disabled) {
                event.preventDefault()
                addTabTrigger?.focus()
              }
            }}
          >
            <DropdownMenuRadioGroup value={selectedValue()} onValueChange={selectValue}>
              <For each={visibleTabIds()}>{(key) => {
                const tab = createMemo(() => tabData(key))
                return (
                  <DropdownMenuRadioItem
                    value={tab().value}
                    aria-label={tab().isBrowser ? text("browser_tab_bc1120de", { v0: tab().browserIndex, v1: tab().title }) : undefined}
                    style={{ "white-space": "normal", "overflow-wrap": "anywhere" }}
                  ><span class="min-w-0">{tab().title}</span></DropdownMenuRadioItem>
                )
              }}</For>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu placement="bottom-end">
          <DropdownMenuTrigger
            as={Button} ref={(node: HTMLButtonElement) => { addTabTrigger = node }} size="icon" variant="ghost" class="size-8 shrink-0"
            aria-label={text("open_workbench_tab_424b2095")}
          ><Plus class="size-4" /></DropdownMenuTrigger>
          <DropdownMenuContent>
            <For each={enabledEntries()}>{(entry) => (
              <DropdownMenuItem disabled={entry.id === "browser" && browserUnavailable()} onSelect={() => openEntry(entry.id)}>
                <Dynamic component={entry.icon} aria-hidden="true" />{nameOf(entry, text)}
              </DropdownMenuItem>
            )}</For>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button size="icon" variant="ghost" aria-label={text("collapse_workbench_739b282d")} onClick={props.onClose}><X /></Button>
      </div>

      <Show when={visible() && props.openToolTabs.includes("inspector")}>
        <TabsContent value="inspector" class="flex min-h-0 overflow-hidden">{props.inspector}</TabsContent>
      </Show>
      <Show when={visible() && props.openToolTabs.includes("review")}>
        <TabsContent value="review" class="flex min-h-0 overflow-hidden">{props.review}</TabsContent>
      </Show>
      <Show when={props.workEnabled && props.openToolTabs.includes("work")}>
        <TabsContent value="work" forceMount class={cn("min-h-0 overflow-hidden", props.activeTab === "work" ? "flex" : "hidden")}>{props.work}</TabsContent>
      </Show>
      <Show when={visible() && browserEnabled() && props.activeTab === "browser"}>
        <TabsContent value={browserValue()} forceMount class="flex min-h-0 min-w-0 overflow-hidden">{props.browser}</TabsContent>
      </Show>
      <Show when={visible() && props.openToolTabs.includes("subagents")}>
        <TabsContent value="subagents" forceMount class={cn("min-h-0 min-w-0 overflow-hidden", props.activeTab === "subagents" ? "flex" : "hidden")}>{props.subagents}</TabsContent>
      </Show>
      <Show when={props.sideChatEnabled && props.openToolTabs.includes("side-chat")}>
        <TabsContent value="side-chat" forceMount class={cn("min-h-0 min-w-0 overflow-hidden", visible() && props.activeTab === "side-chat" ? "flex" : "hidden")}>
          {props.sideChat}
        </TabsContent>
      </Show>
      <Show when={visible() && props.taskDag != null && props.openToolTabs.includes("task-dag")}>
        <TabsContent value="task-dag" class="flex min-h-0 min-w-0 overflow-hidden">{props.taskDag}</TabsContent>
      </Show>
      <Show when={props.activeTab === null}>
        <TabsContent value="launcher" forceMount aria-labelledby={undefined} aria-label={text("workbench_c2730bc7")} class="flex min-h-0 flex-col items-center justify-center overflow-auto p-6">
          <div class="w-full max-w-md">
            <h2 class="text-base font-medium">{text("nothing_open_yet_7202c019")}</h2>
            <p class="mt-1 text-sm text-muted-foreground">{text("choose_a_tool_or_enter_a_url_to_open_a_page_1d14dfed")}</p>
            <div class="mt-5 flex flex-col gap-2">
              <For each={enabledEntries()}>{(entry) => {
                const disabled = () => entry.id === "browser" && browserUnavailable()
                return (
                  <button
                    type="button" disabled={disabled()}
                    class="flex min-h-12 w-full items-center gap-3 rounded-lg border bg-muted/50 px-3 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    onClick={() => openEntry(entry.id)}
                  >
                    <Dynamic component={entry.icon} class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span class="min-w-0 flex-1 text-sm">{nameOf(entry, text)}</span>
                    <span class="text-xs text-muted-foreground">{text(disabled() ? "open_a_session_first_fc83ec3a" : entry.description)}</span>
                  </button>
                )
              }}</For>
            </div>
          </div>
        </TabsContent>
      </Show>
    </Tabs>
  )
}

export function RightWorkbench(props: RightWorkbenchProps) {
  return <RightWorkbenchSurface {...props}><RightWorkbenchContent {...props} /></RightWorkbenchSurface>
}
