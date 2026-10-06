import { uiText, useUiLocale } from "@shared/i18n/ui"
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  FolderClosed,
  FolderOpen,
  List,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  SquarePen,
} from "lucide-react"
import type { ProjectManifest } from "@services/project"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
  onCreateSection,
  onManageSections,
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
  onCreateSection: () => void
  onManageSections: () => void
  onReveal: () => void
  onArchive: () => void
}) {
  useUiLocale()
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
        <span className="ml-auto whitespace-nowrap pl-2 font-normal">{uiText("project_sessions", { count: sessionCount })}</span>
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
        {pinned ? <Pin aria-label={uiText("pinned_fb47db5e")} className="size-3 shrink-0" /> : null}
        <span className="ml-auto whitespace-nowrap font-normal">{sessionCount}</span>
      </button>

      <div className="flex shrink-0 items-center">
        <button
          type="button"
          aria-label={uiText("new_session_in_1e893198", { v0: project.name })}
          disabled={project.status === "archived"}
          className="rounded p-1 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
          onClick={onNewChat}
        >
          <SquarePen className="size-3.5" />
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={uiText("project_actions_4bc7fa27", { v0: project.name })}
            className="rounded p-1 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent"
          >
            <MoreHorizontal className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="right" className="min-w-48 rounded-xl">
            <DropdownMenuItem disabled={project.status === "archived"} onClick={onNewChat}>
              <MessageSquarePlus />{uiText("new_session_58e21b87")}</DropdownMenuItem>
            <DropdownMenuItem onClick={onTogglePin}>
              {pinned ? <PinOff /> : <Pin />} {pinned ? uiText("unpin_c92179b7") : uiText("pin_173f88d2")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onCreateSection}>
              <Plus />{uiText("sidebar_create_section")}</DropdownMenuItem>
            <DropdownMenuItem onClick={onManageSections}>
              <List />{uiText("sidebar_manage_sections")}</DropdownMenuItem>
            <DropdownMenuItem disabled={project.status === "archived"} onClick={onEdit}>
              <Pencil />{uiText("edit_project_577feeef")}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!project.project_path} onClick={onReveal}>
              <FolderOpen />{uiText("show_in_file_manager_1280364b")}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant={project.status === "archived" ? "default" : "destructive"}
              onClick={onArchive}
            >
              {project.status === "archived" ? <ArchiveRestore /> : <Archive />}
              {project.status === "archived" ? uiText("restore_project_52a1d56b") : uiText("remove_local_project_e951cbd0")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
