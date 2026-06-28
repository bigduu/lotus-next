import { type ReactNode } from "react"
import { Menu, PanelRightOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ModelPicker } from "@/components/chat/ModelPicker"
import { ReasoningPicker } from "@/components/chat/ReasoningPicker"
import { OverflowMenu } from "@/components/chat/OverflowMenu"
import { ContextUsageRing } from "@/components/app/ContextUsageRing"
import { BypassToggle } from "@/components/app/BypassToggle"
import type { ReasoningEffort } from "@services/chat/AgentService"

type OverflowItem = { label: string; icon?: ReactNode; onClick: () => void }

export function ChatHeader({
  title,
  hasSession,
  tokenUsage,
  reasoningEffort,
  onChangeReasoning,
  models,
  activeModel,
  onChangeModel,
  bypassPermissions,
  onToggleBypass,
  overflowItems,
  onOpenSidebar,
  onOpenInspector,
  sidebarCollapsed,
}: {
  title: string
  hasSession: boolean
  tokenUsage: { totalTokens: number; maxContextTokens?: number } | undefined
  reasoningEffort: ReasoningEffort
  onChangeReasoning: (effort: ReasoningEffort) => void
  models: string[]
  activeModel: string
  onChangeModel: (model: string) => void
  bypassPermissions: boolean
  onToggleBypass: () => void
  overflowItems: OverflowItem[]
  onOpenSidebar: () => void
  onOpenInspector: () => void
  /** Desktop: sidebar is collapsed, so show the menu button to bring it back. */
  sidebarCollapsed: boolean
}) {
  return (
    <header className="flex items-center gap-2 border-b px-3 py-2.5">
      <Button
        size="icon"
        variant="ghost"
        className={cn("md:hidden", sidebarCollapsed && "md:inline-flex")}
        aria-label="菜单"
        onClick={onOpenSidebar}
      >
        <Menu />
      </Button>
      <span className="flex-1 truncate text-sm font-semibold">{title}</span>
      {tokenUsage ? (
        <ContextUsageRing
          totalTokens={tokenUsage.totalTokens}
          maxContextTokens={tokenUsage.maxContextTokens}
          onClick={onOpenInspector}
        />
      ) : null}
      <ReasoningPicker
        value={reasoningEffort}
        onChange={onChangeReasoning}
        menuPlacement="down"
        menuAlign="right"
      />
      {models.length > 0 ? (
        <ModelPicker
          models={
            activeModel && !models.includes(activeModel) ? [activeModel, ...models] : models
          }
          value={activeModel}
          onChange={onChangeModel}
          menuPlacement="down"
          menuAlign="right"
        />
      ) : null}
      {bypassPermissions ? <BypassToggle onClick={onToggleBypass} /> : null}
      <OverflowMenu items={overflowItems} />
      {hasSession ? (
        <Button size="icon" variant="ghost" aria-label="检查器" onClick={onOpenInspector}>
          <PanelRightOpen />
        </Button>
      ) : null}
    </header>
  )
}
