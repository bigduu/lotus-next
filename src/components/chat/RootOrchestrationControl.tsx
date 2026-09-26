import { CircleHelp } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

type Props = {
  sessionId: string | null
  child: boolean
  unsafe: boolean
  selected: boolean | null
  confirmed: boolean | null
  loading: boolean
  disabled: boolean
  pending: boolean
  recovering: boolean
  recoverable: boolean
  error: string | null
  conflict: string | null
  onChange: (enabled: boolean) => void
  onRetry: () => void
}

export function RootOrchestrationControl({
  sessionId, child, unsafe, selected, confirmed, loading, disabled, pending, recovering, recoverable,
  error, conflict, onChange, onRetry,
}: Props) {
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
            ? selected ? "下次创建时启用" : "下次创建时关闭"
            : changed
              ? selected ? "待启用 · 当前已关闭" : "待关闭 · 当前已启用"
              : confirmed ? "服务器已启用" : "服务器已关闭"

  return (
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5 text-xs" aria-busy={loading || pending || recovering}>
      <label className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-md px-1 hover:bg-accent">
        <input
          type="checkbox"
          aria-label="Root 仅编排模式"
          checked={selected ?? false}
          disabled={unsafe || child || loading || disabled || selected === null}
          onChange={(event) => onChange(event.currentTarget.checked)}
          className="size-4"
        />
        <span>Root 仅编排</span>
      </label>
      <span role="status" aria-live="polite" className="text-muted-foreground">{status}</span>
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" aria-label="查看 Root 仅编排说明" className="rounded p-1 text-muted-foreground hover:text-foreground">
            <CircleHelp className="size-3.5" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" className="text-xs leading-relaxed">
          <p>Root 负责任务编排、子代理进度和纠偏。Root 仅可使用 SubAgent、Plan、Task、session_history_current、Read、Grep、Glob、GetFileInfo 和 ViewImage，不能直接运行命令或编辑文件。</p>
          <p className="mt-2">子代理按各自任务授权执行。此模式与 Skill、Workflow 和旧 PlanMode 不兼容。已有 Root 的切换由 Bamboo 单独确认并保存；新会话在首次发送时保存选择。</p>
        </PopoverContent>
      </Popover>
      {error || conflict ? (
        <span role="alert" className="basis-full text-destructive">
          {conflict || error}
          {recoverable && !child ? (
            <button type="button" className="ml-1 underline" disabled={recovering} onClick={onRetry}>恢复切换</button>
          ) : error && selected === null && !child && !unsafe ? (
            <button type="button" className="ml-1 underline" onClick={onRetry}>重新读取</button>
          ) : null}
        </span>
      ) : null}
    </div>
  )
}
