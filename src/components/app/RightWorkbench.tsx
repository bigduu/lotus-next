import type { ReactNode } from "react"
import { Bot, FileDiff, Globe2, SlidersHorizontal, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

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
  width?: number
}) {
  const body = (
    <Tabs
      value={activeTab}
      onValueChange={(value) => onTabChange(value as RightWorkbenchTab)}
      className="min-h-0 flex-1 gap-0"
    >
      <div className="flex shrink-0 items-center gap-2 border-b px-2 py-2">
        <TabsList aria-label="工作面板工具" className="min-w-0 flex-1 justify-start overflow-x-auto bg-transparent p-0">
          <TabsTrigger value="inspector" className="flex-none px-3">
            <SlidersHorizontal />
            检查器
          </TabsTrigger>
          <TabsTrigger value="review" className="flex-none px-3">
            <FileDiff />
            Review
          </TabsTrigger>
          <TabsTrigger value="browser" className="flex-none px-3">
            <Globe2 />
            浏览器
          </TabsTrigger>
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
      <TabsContent value="browser" className="flex min-h-0 min-w-0 overflow-hidden">
        {browser}
      </TabsContent>
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
