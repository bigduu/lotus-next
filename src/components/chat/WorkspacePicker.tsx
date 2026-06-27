import { useEffect, useState } from "react"
import { Folder, Check, X, Loader2 } from "lucide-react"
import { workspaceService } from "@services/workspace"
import type { Workspace } from "@services/workspace/types"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const input =
  "flex-1 rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"

export function WorkspacePicker({
  open,
  current,
  locked,
  onClose,
  onSelect,
}: {
  open: boolean
  current: string | null
  /** Existing session: cwd is fixed at creation, so selection is informational. */
  locked?: boolean
  onClose: () => void
  onSelect: (path: string | null) => void
}) {
  const [list, setList] = useState<Workspace[]>([])
  const [loading, setLoading] = useState(true)
  const [path, setPath] = useState("")
  const [validating, setValidating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [completions, setCompletions] = useState<Array<{ name: string; path: string }>>([])

  useEffect(() => {
    if (!open) return
    setLoading(true)
    workspaceService
      .getCombinedSuggestions()
      .then(setList)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [open])

  // Live folder autocomplete: browse the typed path's parent dir and filter its
  // subfolders by the trailing segment, so you don't have to remember full paths.
  useEffect(() => {
    if (!open || !path.startsWith("/")) {
      setCompletions([])
      return
    }
    const idx = path.lastIndexOf("/")
    const parent = idx <= 0 ? "/" : path.slice(0, idx)
    const prefix = path.slice(idx + 1).toLowerCase()
    const t = setTimeout(() => {
      workspaceService
        .browseFolder(parent)
        .then((res) =>
          // Show ALL matching subfolders (the list scrolls); only cap at a sane
          // upper bound to avoid rendering thousands of DOM nodes.
          setCompletions(
            res.folders.filter((f) => f.name.toLowerCase().startsWith(prefix)).slice(0, 500),
          ),
        )
        .catch(() => setCompletions([]))
    }, 180)
    return () => clearTimeout(t)
  }, [open, path])

  if (!open) return null

  const choose = (p: string | null) => {
    onSelect(p)
    onClose()
  }

  const validateAndChoose = async () => {
    let p = path.trim()
    if (p.length > 1) p = p.replace(/\/+$/, "")
    if (!p) return
    setValidating(true)
    setError(null)
    try {
      const ws = await workspaceService.validatePath(p)
      if (ws.is_valid) {
        await workspaceService.addRecent(p).catch(() => {})
        choose(p)
      } else {
        setError(ws.error_message || "路径无效")
      }
    } catch {
      setError("校验失败")
    } finally {
      setValidating(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[130] flex items-end justify-center bg-black/50 p-0 md:items-center md:p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border bg-card shadow-2xl md:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-semibold">选择工作目录</span>
          <Button size="icon" variant="ghost" onClick={onClose}>
            <X />
          </Button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {locked ? (
            <p className="rounded-md bg-muted/50 px-2.5 py-2 text-xs text-muted-foreground">
              工作目录在会话创建时设定,当前会话已锁定。下面的选择会用于<strong>新建会话</strong>。
            </p>
          ) : null}

          <div className="flex gap-2">
            <input
              className={input}
              placeholder="绝对路径,如 /Users/you/project"
              value={path}
              autoFocus
              onChange={(e) => setPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void validateAndChoose()
              }}
            />
            <Button size="sm" onClick={validateAndChoose} disabled={!path.trim() || validating}>
              {validating ? <Loader2 className="size-4 animate-spin" /> : "使用"}
            </Button>
          </div>
          {completions.length > 0 ? (
            <ul className="-mt-1 max-h-80 overflow-y-auto rounded-md border bg-background">
              {completions.map((f) => (
                <li key={f.path}>
                  <button
                    onClick={() => setPath(f.path + "/")}
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    <Folder className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{f.name}</span>
                    <span className="ml-auto truncate text-xs text-muted-foreground">{f.path}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}

          {current ? (
            <button
              onClick={() => choose(null)}
              className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              清除 · 用默认目录
            </button>
          ) : null}

          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">最近 / 建议</div>
            {loading ? (
              <p className="text-xs text-muted-foreground">加载中…</p>
            ) : list.length === 0 ? (
              <p className="text-xs text-muted-foreground">暂无</p>
            ) : (
              <ul className="space-y-1">
                {list.map((ws) => (
                  <li key={ws.path}>
                    <button
                      onClick={() => choose(ws.path)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left hover:bg-accent",
                        current === ws.path && "bg-accent",
                      )}
                    >
                      <Folder className="size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">
                          {ws.workspace_name || ws.path.split("/").pop() || ws.path}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">{ws.path}</div>
                      </div>
                      {current === ws.path ? <Check className="size-4 shrink-0 text-primary" /> : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
