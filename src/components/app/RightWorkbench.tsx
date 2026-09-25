import type { ReactNode } from "react"
import { Bot, FileDiff, Globe2, Plus, SlidersHorizontal, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import type { BrowserTabSummary } from "@services/browser/types"

export type RightWorkbenchTab = "inspector" | "review" | "browser" | "session"

export function RightWorkbench({
  activeTab,
  onTabChange,
  onClose,
  inspector,
  review,
  browser,
  session,
  sessionTitle,
  docked = false,
  browserEnabled = true,
  browserTabs,
  activeBrowserTabId,
  browserBusy = false,
  onBrowserCreate,
  onBrowserActivate,
  onBrowserClose,
  width,
}: {
  activeTab: RightWorkbenchTab
  onTabChange: (tab: RightWorkbenchTab) => void
  onClose: () => void
  inspector: ReactNode
  review: ReactNode
  browser: ReactNode
  session: ReactNode
  sessionTitle?: string | null
  docked?: boolean
  browserEnabled?: boolean
  browserTabs?: BrowserTabSummary[] | null
  activeBrowserTabId?: string | null
  browserBusy?: boolean
  onBrowserCreate?: () => void
  onBrowserActivate?: (tabId: string) => void
  onBrowserClose?: (tabId: string) => void
  width?: number
}) {
  const browserValue = activeBrowserTabId && browserTabs?.some((tab) => tab.tab_id === activeBrowserTabId)
    ? `browser:${activeBrowserTabId}`
    : "browser"
  const selectedValue = activeTab === "browser" ? browserValue : activeTab
  const body = (
    <Tabs
      value={selectedValue}
      onValueChange={(value) => {
        if (value.startsWith("browser:")) {
          onTabChange("browser")
          const tabId = value.slice("browser:".length)
          if (tabId !== activeBrowserTabId) onBrowserActivate?.(tabId)
        } else {
          onTabChange(value as RightWorkbenchTab)
        }
      }}
      className="min-h-0 flex-1 gap-0"
    >
      <div className="flex shrink-0 items-center gap-1 border-b bg-muted/50 px-2 pt-1">
        <TabsList aria-label="工作面板标签页" className="min-w-0 flex-1 justify-start overflow-x-auto rounded-none bg-transparent p-0">
          <TabsTrigger value="inspector" className="flex-none px-3">
            <SlidersHorizontal />
            检查器
          </TabsTrigger>
          <TabsTrigger value="review" className="flex-none px-3">
            <FileDiff />
            Review
          </TabsTrigger>
          {browserEnabled ? browserTabs?.length ? browserTabs.map((tab, index) => {
            const title = tab.title || tab.url || "新标签页"
            const isActive = activeTab === "browser" && tab.tab_id === activeBrowserTabId
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
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </div>
            )
          }) : (
            <TabsTrigger value="browser" className="flex-none px-3">
              <Globe2 />
              浏览器
            </TabsTrigger>
          ) : null}
          <TabsTrigger
            value="session"
            className="min-w-0 flex-none px-3"
            style={{ maxWidth: 208 }}
            title={sessionTitle || "并排会话"}
          >
            <Bot />
            <span className="truncate">{sessionTitle || "并排会话"}</span>
          </TabsTrigger>
        </TabsList>
        {browserEnabled ? (
          <Button size="icon" variant="ghost" className="size-8 shrink-0" aria-label="新建浏览器标签页" disabled={browserBusy} onClick={onBrowserCreate}>
            <Plus className="size-4" />
          </Button>
        ) : null}
        <Button size="icon" variant="ghost" aria-label="收起工作面板" onClick={onClose}>
          <X />
        </Button>
      </div>

      <TabsContent value="inspector" className="flex min-h-0 overflow-hidden">
        {inspector}
      </TabsContent>
      <TabsContent value="review" className="flex min-h-0 overflow-hidden">
        {review}
      </TabsContent>
      {browserEnabled ? (
        <TabsContent value={browserValue} className="flex min-h-0 min-w-0 overflow-hidden">
          {browser}
        </TabsContent>
      ) : null}
      <TabsContent value="session" className="flex min-h-0 overflow-hidden">
        {session}
      </TabsContent>
    </Tabs>
  )

  const panel = (
    <aside
      id="right-workbench"
      aria-label="工作面板"
      className={cn(
        "flex min-h-0 flex-col bg-card",
        docked
          ? "shrink-0 border-l"
          : "fixed inset-y-0 right-0 z-50 border-l shadow-lg",
      )}
      style={
        docked
          ? { width: width ?? 520, maxWidth: "46vw" }
          : { width: "min(92vw, 42rem)" }
      }
    >
      {body}
    </aside>
  )

  if (docked) return panel

  return (
    <>
      <button
        className="fixed inset-0 z-40 bg-black/50"
        aria-label="收起工作面板"
        onClick={onClose}
      />
      {panel}
    </>
  )
}
