import { FileDiff } from "lucide-react"
import type { SessionFileChangeGroup } from "@/lib/sessionFileChanges"
import {
  FileChangeDisclosure,
  type FileChangeDensity,
} from "./FileChangeDisclosure"
import {
  displayFileChangePath,
  type FileChangePathMode,
} from "./fileChangePresentation"

export interface FileChangeListProps {
  groups: readonly SessionFileChangeGroup[]
  workspace?: string
  pathMode?: FileChangePathMode
  density?: FileChangeDensity
  defaultOpen?: boolean | ((index: number, total: number) => boolean)
  variant?: "disclosure" | "summary"
  onSelect?: (group: SessionFileChangeGroup) => void
  scrollToGroupId?: string | null
}

const GAP: Record<FileChangeDensity, string> = {
  comfortable: "space-y-3",
  compact: "space-y-1.5",
}

export function FileChangeList({
  groups,
  workspace,
  pathMode = "full",
  density = "comfortable",
  defaultOpen = false,
  variant = "disclosure",
  onSelect,
  scrollToGroupId,
}: FileChangeListProps) {
  if (variant === "summary") {
    return (
      <div className="space-y-0.5">
        {groups.map((group) => {
          const path = displayFileChangePath(group.filePath, pathMode, workspace)
          return (
            <button
              key={group.id}
              type="button"
              className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-xs hover:bg-accent"
              onClick={() => onSelect?.(group)}
              title={`在 Review 中查看 ${path}`}
            >
              <FileDiff className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-mono" title={group.filePath}>
                {path}
              </span>
              {group.changes.length > 1 ? (
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {group.changes.length} 次
                </span>
              ) : null}
              <span className="shrink-0 text-[11px]">
                <span className="text-green-600 dark:text-green-400">+{group.addedLines}</span>{" "}
                <span className="text-red-600 dark:text-red-400">−{group.removedLines}</span>
              </span>
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div className={GAP[density]}>
      {groups.map((group, index) => (
        <FileChangeDisclosure
          key={group.id}
          group={group}
          workspace={workspace}
          pathMode={pathMode}
          density={density}
          defaultOpen={
            typeof defaultOpen === "function" ? defaultOpen(index, groups.length) : defaultOpen
          }
          scrollIntoViewOnMount={group.id === scrollToGroupId}
        />
      ))}
    </div>
  )
}
