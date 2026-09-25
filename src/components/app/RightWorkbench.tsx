import type { ReactNode } from "react"
import { ArrowLeft, Bot, FileDiff, Globe2, Plus, SlidersHorizontal, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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

export function RightWorkbench({
  activeTab,
  openToolTabs,
  onTabChange,
  onToolClose,
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
  const hasTabs = openToolTabs.length > 0 || Boolean(browserTabs?.length)
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
          <TabsList aria-label="工作面板标签页" className="min-w-0 flex-1 justify-start overflow-x-auto rounded-none bg-transparent p-0">
            {openToolTabs.map((tool) => {
              const entry = toolEntries.find((item) => item.id === tool)!
              const Icon = entry.icon
              const title = tool === "session" ? sessionTitle || entry.label : entry.label
              return (
                <div key={tool} className={cn("flex h-9 min-w-0 flex-none items-center rounded-md border", activeTab === tool ? "border-border bg-card" : "border-transparent")}>
                  <TabsTrigger value={tool} title={title} style={{ maxWidth: 176 }} className="h-full min-w-0 justify-start bg-transparent px-2">
                    <Icon className="size-4" />
                    <span className="truncate">{title}</span>
                  </TabsTrigger>
                  <button
                    type="button"
                    aria-label={`关闭${entry.label}标签页`}
                    title={`关闭${entry.label}`}
                    className="mr-1 flex size-6 shrink-0 items-center justify-center rounded-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => onToolClose(tool)}
                  ><X className="size-3.5" aria-hidden="true" /></button>
                </div>
              )
            })}
            {browserEnabled ? browserTabs?.map((tab, index) => {
              const title = tab.title || tab.url || "新标签页"
              const isActive = activeTab === "browser" && !browserEntryOpen && tab.tab_id === activeBrowserTabId
              return (
                <div key={tab.tab_id} style={{ maxWidth: 208 }} className={cn("flex h-9 min-w-0 flex-none items-center rounded-md border text-muted-foreground", isActive ? "border-border bg-card text-foreground" : "border-transparent bg-transparent")}>
                  <TabsTrigger
                    value={`browser:${tab.tab_id}`}
                    aria-label={`浏览器标签页 ${index + 1}：${title}`}
                    title={title}
                    className="h-full min-w-0 flex-1 justify-start bg-transparent px-2 text-xs"
                  >
                    <Globe2 className="size-3.5" />
                    <span className="truncate">{title}</span>
                  </TabsTrigger>
                  <button
                    type="button"
                    aria-label={`关闭浏览器标签页 ${index + 1}：${title}`}
                    title={`关闭 ${title}`}
                    disabled={browserBusy}
                    className="mr-1 flex size-6 shrink-0 items-center justify-center rounded-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    onClick={() => onBrowserClose?.(tab.tab_id)}
                  ><X className="size-3.5" aria-hidden="true" /></button>
                </div>
              )
            }) : null}
          </TabsList>
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
      {openToolTabs.includes("session") ? <TabsContent value="session" className="flex min-h-0 overflow-hidden">{session}</TabsContent> : null}
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
