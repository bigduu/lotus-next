import { useMemo } from "react"
import { FileDiff } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { FileChangeView } from "@/components/chat/FileChangeView"
import {
  collectLiveSessionFileChanges,
  collectSessionFileChanges,
  mergeSessionFileChanges,
  type LiveFileChangeSegment,
} from "@/lib/sessionFileChanges"
import { selectSessionById, useAppStore } from "@shared/store/appStore"
import { getFileChangePayloadDiffStats } from "@shared/utils/resultFormatters"

export function ReviewPane({
  sessionId,
  liveSegments = [],
}: {
  sessionId: string | null
  liveSegments?: readonly LiveFileChangeSegment[]
}) {
  const messages = useAppStore(
    useShallow((state) =>
      sessionId ? (selectSessionById(sessionId)(state)?.messages ?? []) : [],
    ),
  )
  const changes = useMemo(
    () => mergeSessionFileChanges(
      collectSessionFileChanges(messages),
      collectLiveSessionFileChanges(liveSegments),
    ),
    [liveSegments, messages],
  )

  if (!sessionId) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
        打开一个会话后即可查看变更。
      </div>
    )
  }

  if (changes.length === 0) {
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
        <span className="text-xs font-normal text-muted-foreground">({changes.length})</span>
      </div>
      <div className="space-y-3">
        {changes.map(({ id, payload }, index) => {
          const stats = getFileChangePayloadDiffStats(payload)
          return (
            <details key={id} open={index === changes.length - 1} className="rounded-lg border">
              <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-2.5 text-sm hover:bg-accent/50 [&::-webkit-details-marker]:hidden">
                <FileDiff className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-mono" title={payload.file_path}>
                  {payload.file_path}
                </span>
                <span className="shrink-0 text-xs">
                  <span className="text-green-600 dark:text-green-400">+{stats.added}</span>{" "}
                  <span className="text-red-600 dark:text-red-400">−{stats.removed}</span>
                </span>
              </summary>
              <div className="border-t p-2">
                <FileChangeView payload={payload} />
              </div>
            </details>
          )
        })}
      </div>
    </div>
  )
}
