import { useEffect, useRef, type ReactNode } from "react"
import { DragDropProvider } from "@dnd-kit/react"
import { isSortable, useSortable } from "@dnd-kit/react/sortable"
import { ArrowLeft, Bot, FileDiff, Globe2, GripVertical, Plus, SlidersHorizontal, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { visibleWorkbenchTabIds } from "@/lib/workbenchTabs"
import { cn } from "@/lib/utils"
import type { BrowserTabSummary } from "@services/browser/types"

export type RightWorkbenchTab = "inspector" | "review" | "browser" | "session"
export type WorkbenchToolTab = Exclude<RightWorkbenchTab, "browser">

const toolEntries = [
  { id: "inspector", label: "检查器", description: "查看当前会话", icon: SlidersHorizontal },
  { id: "review", label: "Review", description: "查看文件变更", icon: FileDiff },
  { id: "browser", label: "浏览器", description: "输入网址后打开", icon: Globe2 },
  { id: "session", label: "并排会话", description: "打开另一个会话", icon: Bot },
] as const

type VisibleTab =
  | { key: string; kind: "tool"; tool: WorkbenchToolTab }
  | { key: string; kind: "browser"; tab: BrowserTabSummary }

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
  const { ref, handleRef, isDragging } = useSortable({ id, index })
  return (
    <div
      ref={ref}
      className={cn("flex h-9 min-w-0 flex-none items-center rounded-md border text-muted-foreground", selected ? "border-border bg-card text-foreground" : "border-transparent bg-transparent")}
      style={{ maxWidth: 208, opacity: isDragging ? 0.6 : 1 }}
    >
      <button
        ref={handleRef}
        type="button"
        aria-label={`调整${title}标签页顺序`}
        aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
        title="拖动排序；按 Alt + 左右方向键移动"
        className="flex size-5 shrink-0 items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
  sessionTitle,
  docked = false,
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
  sessionTitle?: string | null
  docked?: boolean
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
  const visibleOrderKey = visibleTabIds.join("|")
  useEffect(() => {
    tabListRef.current?.querySelector<HTMLElement>('[role="tab"][data-state="active"]')
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" })
  }, [selectedValue, visibleOrderKey])
  const hasTabs = orderedTabs.length > 0
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
  const body = (
    <Tabs
      value={selectedValue}
      onValueChange={(value) => {
        if (value.startsWith("browser:")) {
          const tabId = value.slice("browser:".length)
          onBrowserActivate?.(tabId)
        } else if (value !== "launcher" && value !== "browser-entry") {
          onTabChange(value as WorkbenchToolTab)
        }
      }}
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
            <TabsList ref={tabListRef} aria-label="工作面板标签页" className="min-w-0 flex-1 justify-start overflow-x-auto rounded-none bg-transparent p-0">
              {orderedTabs.map((item, index) => {
                if (item.kind === "tool") {
                  const entry = toolEntries.find((candidate) => candidate.id === item.tool)!
                  const Icon = entry.icon
                  const title = item.tool === "session" ? sessionTitle || entry.label : entry.label
                  return (
                    <SortableWorkbenchTab key={item.key} id={item.key} index={index} title={title} selected={activeTab === item.tool} onMove={moveTab}>
                      <TabsTrigger value={item.tool} title={title} style={{ maxWidth: 176 }} className="h-full min-w-0 justify-start bg-transparent px-2">
                        <Icon className="size-4" />
                        <span className="truncate">{title}</span>
                      </TabsTrigger>
                      <button
                        type="button"
                        aria-label={`关闭${entry.label}标签页`}
                        title={`关闭${entry.label}`}
                        className="mr-1 flex size-6 shrink-0 items-center justify-center rounded-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => onToolClose(item.tool)}
                      ><X className="size-3.5" aria-hidden="true" /></button>
                    </SortableWorkbenchTab>
                  )
                }
                const title = item.tab.title || item.tab.url || "新标签页"
                const browserIndex = orderedTabs.slice(0, index).filter((candidate) => candidate.kind === "browser").length + 1
                const isActive = activeTab === "browser" && !browserEntryOpen && item.tab.tab_id === activeBrowserTabId
                return (
                  <SortableWorkbenchTab key={item.key} id={item.key} index={index} title={title} selected={isActive} onMove={moveTab}>
                    <TabsTrigger
                      value={item.key}
                      aria-label={`浏览器标签页 ${browserIndex}：${title}`}
                      title={title}
                      className="h-full min-w-0 flex-1 justify-start bg-transparent px-2 text-xs"
                    >
                      <Globe2 className="size-3.5" />
                      <span className="truncate">{title}</span>
                    </TabsTrigger>
                    <button
                      type="button"
                      aria-label={`关闭浏览器标签页 ${browserIndex}：${title}`}
                      title={`关闭 ${title}`}
                      disabled={browserBusy}
                      className="mr-1 flex size-6 shrink-0 items-center justify-center rounded-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                      onClick={() => onBrowserClose?.(item.tab.tab_id)}
                    ><X className="size-3.5" aria-hidden="true" /></button>
                  </SortableWorkbenchTab>
                )
              })}
            </TabsList>
          </DragDropProvider>
        ) : activeTab === "browser" ? (
          <Button size="sm" variant="ghost" className="min-w-0 flex-1 justify-start" onClick={() => onTabChange(null)}>
            <ArrowLeft className="size-4" /> 工作面板
          </Button>
        ) : (
          <span className="min-w-0 flex-1 px-2 text-sm text-muted-foreground">工作面板</span>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" className="size-8 shrink-0" aria-label="打开工作面板标签页">
              <Plus className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {toolEntries.filter((entry) => browserEnabled || entry.id !== "browser").map((entry) => {
              const Icon = entry.icon
              return <DropdownMenuItem key={entry.id} disabled={entry.id === "browser" && (!browserEnabled || !browserSessionAvailable || browserBusy)} onSelect={() => openEntry(entry.id)}><Icon />{entry.label}</DropdownMenuItem>
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button size="icon" variant="ghost" aria-label="收起工作面板" onClick={onClose}><X /></Button>
      </div>

      {openToolTabs.includes("inspector") ? <TabsContent value="inspector" className="flex min-h-0 overflow-hidden">{inspector}</TabsContent> : null}
      {openToolTabs.includes("review") ? <TabsContent value="review" className="flex min-h-0 overflow-hidden">{review}</TabsContent> : null}
      {browserEnabled ? <TabsContent value={browserValue} className="flex min-h-0 min-w-0 overflow-hidden">{browser}</TabsContent> : null}
      {/* Keep an open root session mounted across tab changes so its draft and
          in-flight send survive; App gates child projection by active tab. */}
      {openToolTabs.includes("session") ? (
        <TabsContent value="session" forceMount className={cn("min-h-0 overflow-hidden", activeTab === "session" ? "flex" : "hidden")}>
          {session}
        </TabsContent>
      ) : null}
      <TabsContent value="launcher" className="flex min-h-0 flex-col items-center justify-center overflow-auto p-6">
        <div className="w-full max-w-md">
          <h2 className="text-base font-medium">还没有打开内容</h2>
          <p className="mt-1 text-sm text-muted-foreground">选择工具，或输入网址打开网页</p>
          <div className="mt-5 flex flex-col gap-2">
            {toolEntries.filter((entry) => browserEnabled || entry.id !== "browser").map((entry) => {
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
                  <span className="text-xs text-muted-foreground">{disabled ? "先打开会话" : entry.description}</span>
                </button>
              )
            })}
          </div>
        </div>
      </TabsContent>
    </Tabs>
  )

  const panel = (
    <aside
      id="right-workbench"
      aria-label="工作面板"
      className={cn("flex min-h-0 flex-col bg-card", docked ? "shrink-0 border-l" : "fixed inset-y-0 right-0 z-50 border-l shadow-lg")}
      style={docked ? { width: width ?? 520, maxWidth: "46vw" } : { width: "min(92vw, 42rem)" }}
    >{body}</aside>
  )

  if (docked) return panel
  return <>
    <button className="fixed inset-0 z-40 bg-black/50" aria-label="收起工作面板" onClick={onClose} />
    {panel}
  </>
}
