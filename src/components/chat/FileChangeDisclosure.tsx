import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useEffect, useState } from "react"
import { Columns2, FileDiff, Rows3, WrapText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useContainerWidth } from "@/hooks/useContainerWidth"
import { cn } from "@/lib/utils"
import type { SessionFileChangeGroup } from "@/lib/sessionFileChanges"
import {
  displayFileChangePath,
  type FileChangePathMode,
} from "./fileChangePresentation"
import { FileChangeView, type FileChangeViewMode } from "./FileChangeView"

const SPLIT_DIFF_MIN_WIDTH = 720

export type FileChangeDensity = "comfortable" | "compact"

export interface FileChangeDisclosureProps {
  group: SessionFileChangeGroup
  workspace?: string
  pathMode?: FileChangePathMode
  density?: FileChangeDensity
  defaultOpen?: boolean
  scrollIntoViewOnMount?: boolean
}

const DENSITY_STYLES: Record<
  FileChangeDensity,
  {
    details: string
    summary: string
    icon: string
    stats: string
    body: string
  }
> = {
  comfortable: {
    details: "rounded-lg border bg-background/50",
    summary:
      "sticky top-0 z-20 flex cursor-pointer select-none items-center gap-2 bg-card px-3 py-2.5 text-sm hover:bg-accent [&::-webkit-details-marker]:hidden",
    icon: "size-4 shrink-0 text-muted-foreground",
    stats: "shrink-0 text-xs",
    body: "border-t",
  },
  compact: {
    details: "rounded-md border bg-background/50",
    summary:
      "flex cursor-pointer select-none items-center gap-1.5 px-2 py-1.5 text-xs hover:bg-accent/50 [&::-webkit-details-marker]:hidden",
    icon: "size-3.5 shrink-0 text-muted-foreground",
    stats: "shrink-0 text-[11px]",
    body: "border-t",
  },
}

const OPERATION_LABELS: Record<string, string> = {
  get apply_patch() { return uiText("modify_37090f45") },
  get create() { return uiText("create_cde2cd07") },
  get create_file() { return uiText("create_cde2cd07") },
  get delete() { return uiText("delete_2f9daa82") },
  get delete_file() { return uiText("delete_2f9daa82") },
  get edit() { return uiText("modify_37090f45") },
  get patch() { return uiText("modify_37090f45") },
  get update() { return uiText("modify_37090f45") },
  get write() { return uiText("write_5c783c46") },
  get write_file() { return uiText("write_5c783c46") },
}

function describeOperation(operation: string): string {
  return OPERATION_LABELS[operation.toLowerCase()] ?? operation
}

export function FileChangeDisclosure({
  group,
  workspace,
  pathMode = "full",
  density = "comfortable",
  defaultOpen = false,
  scrollIntoViewOnMount = false,
}: FileChangeDisclosureProps) {
  useUiLocale()
  const [open, setOpen] = useState(defaultOpen)
  const [viewMode, setViewMode] = useState<FileChangeViewMode>("unified")
  const [wrapLines, setWrapLines] = useState(false)
  const [containerRef, containerWidth] = useContainerWidth<HTMLDetailsElement>()
  const styles = DENSITY_STYLES[density]
  const path = displayFileChangePath(group.filePath, pathMode, workspace)
  const canSplit = containerWidth >= SPLIT_DIFF_MIN_WIDTH

  useEffect(() => {
    if (!canSplit && viewMode === "split") setViewMode("unified")
  }, [canSplit, viewMode])

  useEffect(() => {
    if (!defaultOpen || !scrollIntoViewOnMount) return
    const frame = window.requestAnimationFrame(() => {
      containerRef.current?.scrollIntoView({ block: "start" })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [containerRef, defaultOpen, scrollIntoViewOnMount])

  return (
    <details
      ref={containerRef}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className={styles.details}
    >
      <summary
        className={styles.summary}
        style={
          density === "comfortable"
            ? { borderTopLeftRadius: "var(--radius)", borderTopRightRadius: "var(--radius)" }
            : undefined
        }
      >
        <FileDiff className={styles.icon} />
        <span className="min-w-0 flex-1 truncate font-mono" title={group.filePath}>
          {path}
        </span>
        {group.changes.length > 1 ? (
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {uiText("count_changes", { count: group.changes.length })}</span>
        ) : null}
        {group.truncated ? (
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {uiText("truncated_4fb9aa6e")}</span>
        ) : null}
        <span className={styles.stats}>
          <span className="text-green-600 dark:text-green-400">+{group.addedLines}</span>{" "}
          <span className="text-red-600 dark:text-red-400">−{group.removedLines}</span>
        </span>
      </summary>

      {open ? (
        <div className={styles.body}>
          <div
            className={cn(
              "flex items-center gap-1 border-b bg-card px-2 py-1.5",
              density === "comfortable" && "sticky z-10",
            )}
            style={density === "comfortable" ? { top: 41 } : undefined}
          >
            <Button
              type="button"
              size="sm"
              variant={viewMode === "unified" ? "secondary" : "ghost"}
              className="h-7 px-2 text-xs"
              onClick={() => setViewMode("unified")}
              aria-pressed={viewMode === "unified"}
            >
              <Rows3 className="size-3.5" />
              {uiText("unified_a1108b48")}</Button>
            <Button
              type="button"
              size="sm"
              variant={viewMode === "split" ? "secondary" : "ghost"}
              className="h-7 px-2 text-xs"
              onClick={() => setViewMode("split")}
              disabled={!canSplit}
              title={canSplit ? uiText("side_by_side_872790ee") : uiText("expand_the_panel_to_compare_side_by_side_e4c4ced4")}
              aria-pressed={viewMode === "split"}
            >
              <Columns2 className="size-3.5" />
              {uiText("compare_e182fb40")}</Button>
            <div className="flex-1" />
            <Button
              type="button"
              size="sm"
              variant={wrapLines ? "secondary" : "ghost"}
              className="h-7 px-2 text-xs"
              onClick={() => setWrapLines((value) => !value)}
              aria-pressed={wrapLines}
            >
              <WrapText className="size-3.5" />
              {uiText("wrap_bd609a8e")}</Button>
          </div>

          <div className="divide-y">
            {group.changes.map((change, index) => (
              <section key={change.id} aria-label={uiText("change_1d9f6496", { v0: path, v1: index + 1 })}>
                {group.changes.length > 1 ? (
                  <div className="flex items-center gap-2 bg-muted/30 px-2.5 py-1 text-[10px] text-muted-foreground">
                    <span>{uiText("modify_37090f45")} {index + 1} / {group.changes.length}</span>
                    <span aria-hidden="true">·</span>
                    <span>{describeOperation(change.payload.operation)}</span>
                  </div>
                ) : null}
                <div>
                  <FileChangeView
                    payload={change.payload}
                    showHeader={false}
                    viewMode={viewMode}
                    wrapLines={wrapLines}
                    scrollMode="document"
                    allowSplit={canSplit}
                  />
                </div>
              </section>
            ))}
          </div>
        </div>
      ) : null}
    </details>
  )
}
