import type { ReactNode } from "react"
import {
  ChevronRight,
  File,
  FileDiff,
  FolderGit2,
  FolderKanban,
  Image as ImageIcon,
  ListFilter,
  Monitor,
  PanelRightOpen,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import type { SessionPlacement } from "@services/chat/AgentService"

export type EnvironmentSource = {
  id: string
  name: string
  kind: "file" | "image"
  previewUrl?: string
}

function EnvironmentRow({
  icon,
  label,
  detail,
  trailing,
  onClick,
  ariaLabel,
}: {
  icon: ReactNode
  label: string
  detail?: string | null
  trailing?: ReactNode
  onClick?: () => void
  ariaLabel?: string
}) {
  const content = (
    <>
      <span className="text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{label}</span>
        {detail ? (
          <span className="block truncate text-xs text-muted-foreground" title={detail}>
            {detail}
          </span>
        ) : null}
      </span>
      {trailing}
    </>
  )

  return onClick ? (
    <button
      type="button"
      aria-label={ariaLabel}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onClick}
    >
      {content}
    </button>
  ) : (
    <div className="flex items-center gap-3 px-3 py-2">{content}</div>
  )
}

export function EnvironmentLauncher({
  open,
  controlsId,
  onToggle,
}: {
  open: boolean
  controlsId: string
  onToggle: () => void
}) {
  return (
    <Button
      size="icon"
      variant="ghost"
      aria-label={open ? "收起 Environment" : "打开 Environment"}
      aria-expanded={open}
      aria-controls={controlsId}
      onClick={onToggle}
    >
      <ListFilter />
    </Button>
  )
}

export function RightPanelLauncher({
  open,
  onToggle,
}: {
  open: boolean
  onToggle: () => void
}) {
  return (
    <Button
      size="icon"
      variant="ghost"
      aria-label={open ? "收起侧边面板" : "打开侧边面板"}
      aria-expanded={open}
      aria-controls="right-workbench"
      onClick={onToggle}
    >
      <PanelRightOpen />
    </Button>
  )
}

export function EnvironmentCard({
  id,
  workspace,
  projectName,
  placement,
  changedFiles,
  addedLines,
  removedLines,
  sources,
  onOpenReview,
  onPreviewImage,
}: {
  id: string
  workspace?: string | null
  projectName?: string | null
  placement?: SessionPlacement | null
  changedFiles: number
  addedLines: number
  removedLines: number
  sources: EnvironmentSource[]
  onOpenReview: () => void
  onPreviewImage: (src: string) => void
}) {
  const workspaceLabel = workspace
    ? (workspace.split(/[\\/]/).filter(Boolean).at(-1) ?? workspace)
    : "未设置工作区"
  const placementLabel = placement
    ? placement.kind === "local"
      ? "Local"
      : placement.kind
    : "运行位置未确认"

  return (
    <section
      id={id}
      aria-label="Environment"
      data-environment-card
      className="rounded-2xl border bg-popover p-2 text-popover-foreground shadow-lg"
      style={{ width: "20rem", maxWidth: "100%" }}
    >
      <div className="px-3 pb-2 pt-1 text-sm font-semibold">Environment</div>
      <EnvironmentRow
        icon={<FileDiff className="size-4" />}
        label="Changes"
        detail={`${changedFiles} 个变更文件`}
        trailing={
          <span className="flex shrink-0 items-center gap-1 text-xs tabular-nums">
            <span className="text-green-600 dark:text-green-400">+{addedLines}</span>
            <span className="text-red-600 dark:text-red-400">−{removedLines}</span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </span>
        }
        onClick={onOpenReview}
      />
      <EnvironmentRow
        icon={<Monitor className="size-4" />}
        label={placementLabel}
        detail={placement?.host}
      />
      <EnvironmentRow
        icon={<FolderGit2 className="size-4" />}
        label={workspaceLabel}
        detail={workspace}
      />
      {projectName ? (
        <EnvironmentRow
          icon={<FolderKanban className="size-4" />}
          label={projectName}
          detail="Project"
        />
      ) : null}

      <div className="my-2 border-t" style={{ marginInline: "0.5rem" }} />
      <div className="flex items-center justify-between px-3 pb-1 text-sm text-muted-foreground">
        <span>Sources</span>
        <span className="text-xs tabular-nums">{sources.length}</span>
      </div>
      {sources.length > 0 ? (
        <div className="space-y-0.5">
          {sources.slice(0, 5).map((source) => {
            const previewUrl = source.kind === "image" ? source.previewUrl : undefined
            return (
              <EnvironmentRow
                key={source.id}
                icon={
                  previewUrl ? (
                    <img
                      src={previewUrl}
                      alt=""
                      className="size-8 rounded-md border object-cover"
                    />
                  ) : source.kind === "image" ? (
                    <ImageIcon className="size-4" />
                  ) : (
                    <File className="size-4" />
                  )
                }
                label={source.name}
                trailing={
                  previewUrl ? <ChevronRight className="size-4 text-muted-foreground" /> : undefined
                }
                onClick={previewUrl ? () => onPreviewImage(previewUrl) : undefined}
                ariaLabel={previewUrl ? `预览 ${source.name}` : undefined}
              />
            )
          })}
        </div>
      ) : (
        <div className="px-3 py-2 text-xs text-muted-foreground">当前会话暂无来源文件</div>
      )}
    </section>
  )
}
