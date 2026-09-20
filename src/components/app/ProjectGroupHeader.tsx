import { useState } from "react"
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  FolderClosed,
  FolderOpen,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
} from "lucide-react"
import type { ProjectManifest } from "@services/project"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export function ProjectGroupHeader({
  project,
  label,
  sessionCount,
  expanded,
  contentId,
  disabled,
  pinned,
  onToggleExpanded,
  onNewChat,
  onEdit,
  onTogglePin,
  onReveal,
  onArchive,
}: {
  project?: ProjectManifest
  label: string
  sessionCount: number
  expanded: boolean
  contentId: string
  disabled: boolean
  pinned: boolean
  onToggleExpanded: () => void
  onNewChat: () => void
  onEdit: () => void
  onTogglePin: () => void
  onReveal: () => void
  onArchive: () => void
}) {
  const [detailsOpen, setDetailsOpen] = useState(false)

  if (!project) {
    return (
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={contentId}
        disabled={disabled}
        className="flex w-full items-center gap-1 rounded-md px-2 pb-1 pt-3 text-left text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
        onClick={onToggleExpanded}
      >
        <ChevronRight aria-hidden="true" className={cn("size-3 shrink-0", expanded && "rotate-90")} />
        <span className="truncate">{label}</span>
        <span className="ml-auto whitespace-nowrap pl-2 font-normal">{sessionCount} 个会话</span>
      </button>
    )
  }

  return (
    <div className="flex items-center rounded-md px-1 pb-1 pt-2 hover:bg-sidebar-accent">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={contentId}
        disabled={disabled}
        className="flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-1 text-left text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
        onClick={onToggleExpanded}
      >
        <ChevronRight aria-hidden="true" className={cn("size-3 shrink-0", expanded && "rotate-90")} />
        <FolderClosed aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="truncate">{label}</span>
        {pinned ? <Pin aria-label="已置顶" className="size-3 shrink-0" /> : null}
        <span className="ml-auto whitespace-nowrap font-normal">{sessionCount}</span>
      </button>

      <div className="flex shrink-0 items-center">
        <Popover open={detailsOpen} onOpenChange={setDetailsOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`查看 ${project.name} 项目详情`}
              className="rounded p-1 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Pencil className="size-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" side="right" className="w-72 space-y-3 p-3">
            <div className="flex items-start gap-2.5">
              <FolderClosed className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{project.name}</div>
                <div className="mt-1 text-xs text-muted-foreground">{sessionCount} 个会话</div>
              </div>
              {pinned ? <Pin className="size-3.5 text-muted-foreground" /> : null}
            </div>
            <div className="border-t pt-2">
              <div className="mb-1 text-[11px] font-medium text-muted-foreground">源目录</div>
              <div className="truncate text-xs" title={project.project_path ?? undefined}>
                {project.project_path || "未配置"}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              disabled={project.status === "archived"}
              onClick={() => {
                setDetailsOpen(false)
                onEdit()
              }}
            >
              <Pencil className="size-3.5" /> 编辑项目
            </Button>
          </PopoverContent>
        </Popover>

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`${project.name} 项目操作`}
            className="rounded p-1 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent"
          >
            <MoreHorizontal className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="right" className="min-w-48 rounded-xl">
            <DropdownMenuItem disabled={project.status === "archived"} onClick={onNewChat}>
              <MessageSquarePlus /> 新建会话
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onTogglePin}>
              {pinned ? <PinOff /> : <Pin />} {pinned ? "取消置顶" : "置顶"}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={project.status === "archived"} onClick={onEdit}>
              <Pencil /> 编辑项目
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!project.project_path} onClick={onReveal}>
              <FolderOpen /> 在 Finder 中显示
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant={project.status === "archived" ? "default" : "destructive"}
              onClick={onArchive}
            >
              {project.status === "archived" ? <ArchiveRestore /> : <Archive />}
              {project.status === "archived" ? "恢复项目" : "移除本地项目"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
