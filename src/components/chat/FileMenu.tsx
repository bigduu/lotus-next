import type { WorkspaceFileEntry } from "@services/workspace/types"

/**
 * "@" file-reference picker shown above the composer when the draft ends with an
 * "@query". Lists workspace files filtered by the query; picking one inserts its
 * path into the message.
 */
export function FileMenu({
  files,
  query,
  onPick,
}: {
  files: WorkspaceFileEntry[]
  query: string
  onPick: (entry: WorkspaceFileEntry) => void
}) {
  const q = query.trim().toLowerCase()
  const filtered = files
    .filter((f) => !f.is_directory && (!q || f.path.toLowerCase().includes(q)))
    .slice(0, 8)

  if (filtered.length === 0) return null

  return (
    <div className="mx-auto mb-2 max-w-2xl overflow-hidden rounded-xl border bg-popover shadow-lg">
      <div className="border-b px-3 py-1.5 text-xs text-muted-foreground">工作区文件</div>
      <div className="max-h-64 overflow-y-auto p-1">
        {filtered.map((f) => (
          <button
            key={f.path}
            onClick={() => onPick(f)}
            className="block w-full truncate rounded-lg px-3 py-1.5 text-left text-sm transition-colors hover:bg-accent"
          >
            {f.path}
          </button>
        ))}
      </div>
    </div>
  )
}
