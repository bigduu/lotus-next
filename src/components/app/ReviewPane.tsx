import { useMemo } from "react"
import { FileDiff } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { FileChangeList } from "@/components/chat/FileChangeList"
import {
  collectLiveSessionFileChanges,
  collectSessionFileChanges,
  groupSessionFileChanges,
  mergeSessionFileChanges,
  summarizeSessionFileChangeGroups,
  type LiveFileChangeSegment,
} from "@/lib/sessionFileChanges"
import { selectSessionById, useAppStore } from "@shared/store/appStore"

export function ReviewPane({
  sessionId,
  liveSegments = [],
  workspace,
  targetFilePath,
}: {
  sessionId: string | null
  liveSegments?: readonly LiveFileChangeSegment[]
  workspace?: string | null
  targetFilePath?: string | null
}) {
  const messages = useAppStore(
    useShallow((state) =>
      sessionId ? (selectSessionById(sessionId)(state)?.messages ?? []) : [],
    ),
  )
  const changes = useMemo(
    () =>
      mergeSessionFileChanges(
        collectSessionFileChanges(messages),
        collectLiveSessionFileChanges(liveSegments),
      ),
    [liveSegments, messages],
  )
  const groups = useMemo(
    () => groupSessionFileChanges(changes, workspace ?? undefined),
    [changes, workspace],
  )
  const summary = useMemo(() => summarizeSessionFileChangeGroups(groups), [groups])

  if (!sessionId) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
        打开一个会话后即可查看变更。
      </div>
    )
  }

  if (groups.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
        <FileDiff className="size-6 opacity-60" />
        <p>当前会话还没有可 Review 的文件变更。</p>
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium">
        <FileDiff className="size-4 text-muted-foreground" />
        <span>文件变更</span>
        <span className="text-xs font-normal text-muted-foreground">
          {summary.fileCount} 个文件 · {summary.editCount} 次修改
        </span>
        <span className="ml-auto shrink-0 text-xs font-normal">
          <span className="text-green-600 dark:text-green-400">+{summary.addedLines}</span>{" "}
          <span className="text-red-600 dark:text-red-400">−{summary.removedLines}</span>
        </span>
      </div>
      <FileChangeList
        key={targetFilePath ?? "latest"}
        groups={groups}
        workspace={workspace ?? undefined}
        pathMode="relative"
        density="comfortable"
        defaultOpen={(index, total) =>
          targetFilePath
            ? groups[index]?.filePath === targetFilePath
            : index === total - 1
        }
        scrollToGroupId={targetFilePath ? `file:${targetFilePath}` : null}
      />
    </div>
  )
}
