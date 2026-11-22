import { uiText, useUiLocale } from "@shared/i18n/ui"
import { FileDiff } from "lucide-react"
import { FileChangeList } from "@/components/chat/FileChangeList"
import { Button } from "@/components/ui/button"
import type { SessionFileChangeGroup, SessionFileChangeSummary } from "@/lib/sessionFileChanges"

export function ReviewPane({
  sessionId,
  groups,
  summary,
  subagentChanges,
  workspace,
  targetFile,
}: {
  sessionId: string | null
  groups: readonly SessionFileChangeGroup[]
  summary: SessionFileChangeSummary
  subagentChanges: { loading: boolean; unavailable: boolean; truncated: boolean; retry: () => void }
  workspace?: string | null
  targetFile?: string | null
}) {
  useUiLocale()
  const selectedId = groups.find((group) => group.id === targetFile)?.id
    ?? groups.find((group) => group.filePath === targetFile)?.id
  const { loading, unavailable, truncated, retry } = subagentChanges
  const status = loading || unavailable || truncated ? (
    <div role="status" className="mb-3 space-y-1 text-xs text-muted-foreground">
      {loading ? <p>{uiText("review_subagent_changes_loading")}</p> : null}
      {unavailable && !loading ? (
        <div className="flex items-center gap-2">
          <p>{uiText("review_subagent_changes_unavailable")}</p>
          <Button variant="ghost" size="sm" onClick={retry}>{uiText("retry_b8784c8d")}</Button>
        </div>
      ) : null}
      {truncated ? <p>{uiText("review_subagent_changes_truncated")}</p> : null}
    </div>
  ) : null

  if (!sessionId) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
        {uiText("open_a_session_to_view_changes_7de76304")}</div>
    )
  }

  if (groups.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
        <FileDiff className="size-6 opacity-60" />
        {status ?? <p>{uiText("this_session_has_no_file_changes_to_review_yet_062e5342")}</p>}
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium">
        <FileDiff className="size-4 text-muted-foreground" />
        <span>{uiText("file_changes_4d016b2f")}</span>
        <span className="text-xs font-normal text-muted-foreground">
          {uiText("count_files", { count: summary.fileCount })} · {uiText("count_changes", { count: summary.editCount })}</span>
        <span className="ml-auto shrink-0 text-xs font-normal">
          <span className="text-green-600 dark:text-green-400">+{summary.addedLines}</span>{" "}
          <span className="text-red-600 dark:text-red-400">−{summary.removedLines}</span>
        </span>
      </div>
      {status}
      <FileChangeList
        key={targetFile ?? "latest"}
        groups={groups}
        workspace={workspace ?? undefined}
        pathMode="relative"
        density="comfortable"
        defaultOpen={(index, total) =>
          targetFile
            ? groups[index]?.id === selectedId
            : index === total - 1
        }
        scrollToGroupId={selectedId ?? null}
      />
    </div>
  )
}
