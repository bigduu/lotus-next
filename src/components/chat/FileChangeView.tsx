import { useMemo, useState } from "react"
import { Columns2, FileDiff, WrapText } from "lucide-react"
import { cn } from "@/lib/utils"
import { useIsWide } from "@shared/hooks/useMediaQuery"
import {
  parseUnifiedDiffLines,
  parseUnifiedDiffSideBySideRows,
  extractDiffStatsFromUnified,
  type FileChangeResultPayload,
  type DiffLineKind,
} from "@shared/utils/resultFormatters"

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

/**
 * Renders a file-editing tool result as a real diff (ported from lotus's
 * FileChangeViewer): unified view by default, side-by-side toggle on wide
 * screens. Parsing lives in shared/utils/resultFormatters (already ported).
 */
export function FileChangeView({ payload }: { payload: FileChangeResultPayload }) {
  const isWide = useIsWide()
  const [sideBySide, setSideBySide] = useState(false)
  const unified = payload.diff?.unified ?? ""

  const stats = useMemo(() => {
    const added = payload.diff?.added_lines
    const removed = payload.diff?.removed_lines
    if (typeof added === "number" && typeof removed === "number") return { added, removed }
    return extractDiffStatsFromUnified(unified)
  }, [payload.diff, unified])

  const lines = useMemo(() => parseUnifiedDiffLines(unified), [unified])
  const rows = useMemo(
    () => (sideBySide && isWide ? parseUnifiedDiffSideBySideRows(unified) : []),
    [sideBySide, isWide, unified],
  )

  if (!unified.trim()) return null

  const fileName = payload.file_path?.split("/").filter(Boolean).pop() || payload.file_path

  return (
    <div className="overflow-hidden rounded-md border bg-background/60">
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
        {isWide ? (
          <button
            type="button"
            onClick={() => setSideBySide((v) => !v)}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            title={sideBySide ? "统一视图" : "对照视图"}
            aria-label={sideBySide ? "统一视图" : "对照视图"}
          >
            {sideBySide ? <WrapText className="size-3.5" /> : <Columns2 className="size-3.5" />}
          </button>
        ) : null}
      </div>

      {sideBySide && isWide ? (
        <div className="max-h-72 overflow-auto font-mono text-[11px] leading-relaxed">
          <table className="w-full border-collapse">
            <tbody>
              {rows.map((r, i) => {
                if (r.kind === "meta" || r.kind === "hunk") {
                  return (
                    <tr key={i}>
                      <td colSpan={4} className={cn("px-2 py-0.5", LINE_STYLES[r.kind])}>
                        {r.text}
                      </td>
                    </tr>
                  )
                }
                const oldCls =
                  r.kind === "remove" || r.kind === "modified" ? CELL_STYLES.remove : undefined
                const newCls =
                  r.kind === "add" || r.kind === "modified" ? CELL_STYLES.add : undefined
                return (
                  <tr key={i} className="align-top">
                    <td className="w-8 select-none border-r px-1 text-right text-muted-foreground/60">
                      {r.oldLineNumber ?? ""}
                    </td>
                    <td className={cn("w-1/2 whitespace-pre-wrap break-all px-2", oldCls)}>
                      {r.kind === "add" ? "" : (r.oldText ?? r.text ?? "")}
                    </td>
                    <td className="w-8 select-none border-x px-1 text-right text-muted-foreground/60">
                      {r.newLineNumber ?? ""}
                    </td>
                    <td className={cn("w-1/2 whitespace-pre-wrap break-all px-2", newCls)}>
                      {r.kind === "remove" ? "" : (r.newText ?? r.text ?? "")}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <pre className="max-h-72 overflow-auto text-[11px] leading-relaxed">
          {lines.map((l, i) => (
            <div key={i} className={cn("whitespace-pre-wrap break-all px-2.5", LINE_STYLES[l.kind])}>
              {l.text || " "}
            </div>
          ))}
        </pre>
      )}
    </div>
  )
}
