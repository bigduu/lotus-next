import { CircleHelp } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { ReasoningEffortSelection } from "@shared/utils/reasoningEffort"

const ordinaryLabels: Record<ReasoningEffortSelection, string> = {
  auto: "自动", none: "关闭", low: "低", medium: "中", high: "高", xhigh: "极高", max: "最大",
}

type Props = {
  sessionId: string | null
  child: boolean
  unsafe: boolean
  selected: boolean | null
  confirmed: boolean | null
  loading: boolean
  pending: boolean
  recovering: boolean
  recoverable: boolean
  error: string | null
  conflict: string | null
  ordinaryValue: ReasoningEffortSelection
  onRetry: () => void
}

export function RootOrchestrationControl({
  sessionId, child, unsafe, selected, confirmed, loading, pending, recovering, recoverable,
  error, conflict, ordinaryValue, onRetry,
}: Props) {
  if (child) return null
  const changed = sessionId && typeof selected === "boolean" && typeof confirmed === "boolean"
    && selected !== confirmed
  const status = unsafe
    ? recovering ? "正在恢复权限结果…" : "权限结果未知"
    : child
    ? "仅 Root 可设置"
    : loading
      ? "读取服务器状态…"
      : sessionId && selected === null
        ? "状态不可用"
        : pending
          ? "等待服务器确认…"
          : !sessionId
            ? selected ? "下次创建时使用 Ultra 编排" : "下次创建时使用普通模式"
            : changed
              ? selected ? "待启用 · 当前已关闭" : "待关闭 · 当前已启用"
              : confirmed ? "服务器已确认 Ultra 编排" : "服务器已确认普通模式"

  return (
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5 text-xs" aria-busy={loading || pending || recovering}>
      <span role="status" aria-live="polite" className="text-muted-foreground">{status}</span>
      {selected !== null ? <span className="text-muted-foreground">单次推理：{ordinaryLabels[ordinaryValue]}</span> : null}
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" aria-label="查看 Ultra 编排说明" className="rounded p-1 text-muted-foreground hover:text-foreground">
            <CircleHelp className="size-3.5" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" className="text-xs leading-relaxed">
          <p>Ultra 是高于 Max 的独立 Root 编排模式。Root 委派规划和执行任务，管理子代理进度、纠偏，并核验、汇总结果。单次推理强度独立保留，自动档继承当前设置。</p>
          <p className="mt-2">Root 可使用 SubAgent、Plan、Task、session_history_current、Read、Grep、Glob、GetFileInfo 和 ViewImage。子代理按各自任务授权执行。</p>
          <p className="mt-2">此模式与 Skill、Workflow 和旧 PlanMode 不兼容。已有 Root 的切换由 Bamboo 单独确认并保存；新会话在首次发送时保存选择。</p>
        </PopoverContent>
      </Popover>
      {error || conflict ? (
        <span role="alert" className="basis-full text-destructive">
          {conflict || error}
          {recoverable && !child ? (
            <button type="button" className="ml-1 underline" disabled={recovering || pending} onClick={onRetry}>恢复切换</button>
          ) : error && !child && !unsafe ? (
            <button type="button" className="ml-1 underline" disabled={pending} onClick={onRetry}>重新读取</button>
          ) : null}
        </span>
      ) : null}
    </div>
  )
}
