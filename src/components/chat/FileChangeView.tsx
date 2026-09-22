import { useMemo, useState } from "react"
import { Columns2, FileDiff, Rows3, WrapText } from "lucide-react"
import { useContainerWidth } from "@/hooks/useContainerWidth"
import { cn } from "@/lib/utils"
import {
  getFileChangePayloadDiffStats,
  parseUnifiedDiffLines,
  parseUnifiedDiffSideBySideRows,
  type DiffLineKind,
  type FileChangeResultPayload,
} from "@shared/utils/resultFormatters"

const SPLIT_DIFF_MIN_WIDTH = 720

const LINE_STYLES: Partial<Record<DiffLineKind, string>> = {
  add: "bg-green-500/10 text-green-700 dark:text-green-400",
  modified_add: "bg-green-500/10 text-green-700 dark:text-green-400",
  remove: "bg-red-500/10 text-red-700 dark:text-red-400",
  modified_remove: "bg-red-500/10 text-red-700 dark:text-red-400",
  hunk: "bg-muted/70 text-muted-foreground",
  meta: "text-muted-foreground",
  gap: "text-muted-foreground/50",
}

const CELL_STYLES: Record<string, string> = {
  add: "bg-green-500/10 text-green-700 dark:text-green-400",
  remove: "bg-red-500/10 text-red-700 dark:text-red-400",
}

export type FileChangeViewMode = "unified" | "split"
export type FileChangeScrollMode = "contained" | "document"

export interface FileChangeViewProps {
  payload: FileChangeResultPayload
  showHeader?: boolean
  viewMode?: FileChangeViewMode
  wrapLines?: boolean
  scrollMode?: FileChangeScrollMode
  allowSplit?: boolean
}

function isDuplicateFileMetaLine(text: string): boolean {
  return text.startsWith("--- ") || text.startsWith("+++ ")
}

/**
 * Renders one file-edit operation. Parent surfaces own grouping, path display,
 * and the page-level scroll; the standalone defaults remain useful in chat.
 */
export function FileChangeView({
  payload,
  showHeader = true,
  viewMode,
  wrapLines,
  scrollMode = "contained",
  allowSplit,
}: FileChangeViewProps) {
  const [containerRef, containerWidth] = useContainerWidth<HTMLDivElement>(allowSplit === undefined)
  const [internalViewMode, setInternalViewMode] = useState<FileChangeViewMode>("unified")
  const [internalWrapLines, setInternalWrapLines] = useState(false)
  const unified = payload.diff?.unified ?? ""

  const stats = useMemo(() => getFileChangePayloadDiffStats(payload), [payload])
  const canSplit = allowSplit ?? containerWidth >= SPLIT_DIFF_MIN_WIDTH
  const requestedViewMode = viewMode ?? internalViewMode
  const effectiveViewMode = requestedViewMode === "split" && canSplit ? "split" : "unified"
  const shouldWrapLines = wrapLines ?? internalWrapLines

  const lines = useMemo(
    () => parseUnifiedDiffLines(unified).filter((line) => !isDuplicateFileMetaLine(line.text)),
    [unified],
  )
  const rows = useMemo(
    () =>
      effectiveViewMode === "split"
        ? parseUnifiedDiffSideBySideRows(unified).filter(
            (row) => row.kind !== "meta" || !isDuplicateFileMetaLine(row.text ?? ""),
          )
        : [],
    [effectiveViewMode, unified],
  )

  if (!unified.trim()) return null

  const fileName = payload.file_path?.split(/[\\/]/).filter(Boolean).pop() || payload.file_path
  const overflowClass = scrollMode === "contained" ? "max-h-72 overflow-auto" : "overflow-x-auto"
  const whitespaceClass = shouldWrapLines ? "whitespace-pre-wrap break-words" : undefined

  return (
    <div
      ref={containerRef}
      className={cn(showHeader && "overflow-hidden rounded-md border bg-background/50")}
    >
      {showHeader ? (
        <div className="flex items-center gap-2 border-b bg-muted/40 px-2.5 py-1.5">
          <FileDiff className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-mono text-[11px]" title={payload.file_path}>
            {fileName}
          </span>
          <span className="shrink-0 text-[11px]">
            <span className="text-green-600 dark:text-green-400">+{stats.added}</span>{" "}
            <span className="text-red-600 dark:text-red-400">−{stats.removed}</span>
          </span>
          {payload.diff?.truncated ? (
            <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">
              已截断
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => setInternalWrapLines((value) => !value)}
            className={cn(
              "shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground",
              shouldWrapLines && "bg-accent text-foreground",
            )}
            title={shouldWrapLines ? "不换行" : "自动换行"}
            aria-label={shouldWrapLines ? "不换行" : "自动换行"}
            aria-pressed={shouldWrapLines}
          >
            <WrapText className="size-3.5" />
          </button>
          {canSplit ? (
            <button
              type="button"
              onClick={() =>
                setInternalViewMode((current) => (current === "split" ? "unified" : "split"))
              }
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              title={effectiveViewMode === "split" ? "统一视图" : "对照视图"}
              aria-label={effectiveViewMode === "split" ? "统一视图" : "对照视图"}
            >
              {effectiveViewMode === "split" ? (
                <Rows3 className="size-3.5" />
              ) : (
                <Columns2 className="size-3.5" />
              )}
            </button>
          ) : null}
        </div>
      ) : null}

      {effectiveViewMode === "split" ? (
        <div className={cn(overflowClass, "font-mono text-xs leading-relaxed")}>
          <table className="w-full border-collapse" style={{ minWidth: "42rem" }}>
            <tbody>
              {rows.map((row, index) => {
                if (row.kind === "meta" || row.kind === "hunk") {
                  return (
                    <tr key={index}>
                      <td colSpan={4} className={cn("px-2 py-0.5", LINE_STYLES[row.kind])}>
                        {row.text}
                      </td>
                    </tr>
                  )
                }

                const oldClass =
                  row.kind === "remove" || row.kind === "modified" ? CELL_STYLES.remove : undefined
                const newClass =
                  row.kind === "add" || row.kind === "modified" ? CELL_STYLES.add : undefined

                return (
                  <tr key={index} className="align-top">
                    <td className="w-8 select-none border-r px-1 text-right text-muted-foreground/60">
                      {row.oldLineNumber ?? ""}
                    </td>
                    <td
                      className={cn("w-1/2 px-2", whitespaceClass, oldClass)}
                      style={shouldWrapLines ? undefined : { whiteSpace: "pre" }}
                    >
                      {row.kind === "add" ? "" : (row.oldText ?? row.text ?? "")}
                    </td>
                    <td className="w-8 select-none border-x px-1 text-right text-muted-foreground/60">
                      {row.newLineNumber ?? ""}
                    </td>
                    <td
                      className={cn("w-1/2 px-2", whitespaceClass, newClass)}
                      style={shouldWrapLines ? undefined : { whiteSpace: "pre" }}
                    >
                      {row.kind === "remove" ? "" : (row.newText ?? row.text ?? "")}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          role="table"
          aria-label={`${fileName} 统一差异`}
          className={cn(overflowClass, "font-mono text-xs leading-relaxed")}
        >
          {lines.map((line, index) => (
            <div
              key={index}
              role="row"
              className={cn("px-2.5", whitespaceClass, LINE_STYLES[line.kind])}
              style={
                shouldWrapLines
                  ? undefined
                  : { minWidth: "max-content", whiteSpace: "pre" }
              }
            >
              {line.text || " "}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
