import { useEffect, useState } from "react"
import { Wrench, ChevronRight, Loader2 } from "lucide-react"
import type { Message } from "@shared/types/chatMessages"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { useBackgroundBash } from "@shared/store/appStore"
import i18n from "@shared/i18n"

type Entry = {
  toolName: string
  params?: Record<string, unknown>
  result?: { text: string; isError: boolean }
  /** Set when the result marks a background/async shell (see parseBackgroundBash). */
  background?: { bashId: string; command: string }
}

/**
 * A background/async tool LAUNCH returns a NORMAL result whose JSON body carries
 * `{ bash_id, command, status: "running", cwd, environment }`. Detect it
 * structurally (there is no marker on `display_preference`).
 *
 * The `command` field is the load-bearing discriminator: BashOutput
 * (`{bash_id, status, exit_code, output, ...}`) and BashInput
 * (`{bash_id, status, bytes_written, ...}`) results ALSO report
 * `status: "running"` while the shell is alive but carry NO `command`. Without
 * requiring it, reading/feeding a running shell would render as a "running in
 * background" launch and share the launcher's bash_id (flipping together on
 * completion). So: non-null iff bash_id AND a non-empty command are present.
 */
function parseBackgroundBash(
  resultText: string,
): { bashId: string; command: string } | null {
  let obj: unknown
  try {
    obj = JSON.parse(resultText)
  } catch {
    return null
  }
  if (
    obj &&
    typeof obj === "object" &&
    typeof (obj as { bash_id?: unknown }).bash_id === "string" &&
    (obj as { status?: unknown }).status === "running" &&
    typeof (obj as { command?: unknown }).command === "string" &&
    (obj as { command: string }).command.length > 0
  ) {
    const o = obj as { bash_id: string; command: string }
    return { bashId: o.bash_id, command: o.command }
  }
  return null
}

const VISIBLE_CAP = 3

// Noisy keys that bloat the display (huge PATH / env dumps) — never shown.
const NOISE_KEYS = new Set(["environment", "env", "cwd", "import_shell", "path_env"])
// The "headline" argument to show prominently, per tool.
const PRIMARY_KEYS = [
  "command",
  "query",
  "file_path",
  "path",
  "pattern",
  "url",
  "content",
  "prompt",
  "description",
  "action",
]

function cleanParams(params?: Record<string, unknown>): {
  primary?: string
  rest: [string, string][]
} {
  if (!params) return { rest: [] }
  const primaryKey = PRIMARY_KEYS.find((k) => typeof params[k] === "string" && params[k])
  const primary = primaryKey ? String(params[primaryKey]) : undefined
  const rest: [string, string][] = []
  for (const [k, v] of Object.entries(params)) {
    if (k === primaryKey || NOISE_KEYS.has(k) || v == null || v === "" || v === false) continue
    const val = typeof v === "string" ? v : JSON.stringify(v)
    rest.push([k, val.length > 60 ? val.slice(0, 60) + "…" : val])
  }
  return { primary, rest }
}

// Strip noisy keys from a JSON-shaped tool result and pretty-print it; plain
// text passes through.
function prettyResult(text: string): string {
  const trimmed = text.trim()
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const obj = JSON.parse(trimmed)
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        for (const k of NOISE_KEYS) delete (obj as Record<string, unknown>)[k]
      }
      return JSON.stringify(obj, null, 2)
    } catch {
      /* not JSON — fall through */
    }
  }
  return text
}

function buildEntries(items: Message[]): Entry[] {
  const calls: { id: string; toolName: string; params?: Record<string, unknown> }[] = []
  const results = new Map<string, { text: string; isError: boolean }>()
  for (const m of items) {
    const t = (m as { type?: string }).type
    if (t === "tool_call") {
      const tcs =
        (m as { toolCalls?: { toolCallId: string; toolName: string; parameters?: Record<string, unknown> }[] })
          .toolCalls ?? []
      for (const tc of tcs)
        calls.push({ id: tc.toolCallId, toolName: tc.toolName, params: tc.parameters })
    } else if (t === "tool_result") {
      const r = m as {
        toolCallId?: string
        isError?: boolean
        result?: { result?: string }
      }
      if (r.toolCallId)
        results.set(r.toolCallId, {
          text: typeof r.result?.result === "string" ? r.result.result : "",
          isError: Boolean(r.isError),
        })
    }
  }
  return calls.map((c) => {
    const result = results.get(c.id)
    const background = result ? parseBackgroundBash(result.text) : null
    return {
      toolName: c.toolName,
      params: c.params,
      result,
      background: background ?? undefined,
    }
  })
}

/**
 * Badge reflecting a background shell's state. Reads the reactive store keyed by
 * `bash_id` so it flips from the amber "Running in background" spinner to a
 * success / neutral / destructive terminal badge the moment `bash_completed`
 * arrives — no history reload required.
 */
function BackgroundBadge({ bashId }: { bashId: string }) {
  const done = useBackgroundBash(bashId)
  if (!done) {
    return (
      <Badge variant="warning">
        <Loader2 className="size-3 animate-spin" />
        {i18n.t("chat.tools.runningInBackground")}
      </Badge>
    )
  }
  const { status, exitCode } = done
  const exitSuffix = exitCode == null ? "" : ` · exit ${exitCode}`
  if (status === "completed" && (exitCode === 0 || exitCode == null)) {
    return (
      <Badge variant="success">
        {i18n.t("chat.tools.backgroundCompleted")}
        {exitSuffix}
      </Badge>
    )
  }
  if (status === "killed") {
    return <Badge variant="secondary">{i18n.t("chat.tools.backgroundKilled")}</Badge>
  }
  return (
    <Badge variant="destructive">
      {i18n.t("chat.tools.backgroundFailed")}
      {exitSuffix}
    </Badge>
  )
}

function EntryRow({ e }: { e: Entry }) {
  const { primary, rest } = cleanParams(e.params)
  const result = e.result?.text ? prettyResult(e.result.text) : ""
  return (
    <div className="rounded-md bg-background/40 px-2.5 py-2">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-foreground">{e.toolName}</span>
        {e.result?.isError ? <span className="text-[10px] text-destructive">出错</span> : null}
        {e.background ? <BackgroundBadge bashId={e.background.bashId} /> : null}
      </div>
      {primary ? (
        <div className="mt-1 line-clamp-3 break-all rounded bg-muted/50 px-2 py-1 font-mono text-[11px] text-foreground [overflow-wrap:anywhere]">
          {primary}
        </div>
      ) : null}
      {rest.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
          {rest.map(([k, v]) => (
            <span key={k}>
              <span className="opacity-60">{k}:</span> {v}
            </span>
          ))}
        </div>
      ) : null}
      {result ? (
        <details className="mt-1.5">
          <summary className="cursor-pointer select-none text-[11px] text-muted-foreground hover:text-foreground">
            结果
          </summary>
          <pre className="mt-1 max-h-44 overflow-auto whitespace-pre-wrap break-all rounded bg-background/60 p-2 text-[11px] text-muted-foreground">
            {result.length > 1000 ? result.slice(0, 1000) + "…" : result}
          </pre>
        </details>
      ) : null}
    </div>
  )
}

/**
 * Compact, balanced tool-call display. Collapsed = a single pill showing real
 * tool names. The active (streaming) round auto-expands with a spinner and
 * shows the details of the latest few tools; once finished it auto-collapses.
 * To avoid a wall of detail, only the latest {VISIBLE_CAP} tools render expanded
 * — earlier ones fold behind a "展开更早的 N 个" toggle.
 */
export function ToolCalls({ items, active }: { items: Message[]; active?: boolean }) {
  const [open, setOpen] = useState(Boolean(active))
  const [touched, setTouched] = useState(false)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    if (!touched) setOpen(Boolean(active))
  }, [active, touched])

  const entries = buildEntries(items)
  const uniqueNames = Array.from(new Set(entries.map((e) => e.toolName).filter(Boolean)))
  const label =
    uniqueNames.length === 0
      ? `${items.length} 次工具调用`
      : uniqueNames.length <= 2
        ? uniqueNames.join("、")
        : `${uniqueNames.slice(0, 2).join("、")} 等 ${uniqueNames.length} 个工具`

  const visible = showAll ? entries : entries.slice(-VISIBLE_CAP)
  const hidden = entries.length - visible.length

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[85%]">
        <button
          type="button"
          onClick={() => {
            setTouched(true)
            setOpen((v) => !v)
          }}
          className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-muted/60 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted"
        >
          {active ? (
            <Loader2 className="size-3 shrink-0 animate-spin" />
          ) : (
            <Wrench className="size-3 shrink-0" />
          )}
          <span className="truncate">{label}</span>
          <ChevronRight className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")} />
        </button>

        {open ? (
          <div className="mt-1.5 space-y-2 rounded-lg border bg-card/50 p-2.5 text-xs">
            {hidden > 0 ? (
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
              >
                ▸ 展开更早的 {hidden} 个调用
              </button>
            ) : null}
            {visible.map((e, i) => (
              <EntryRow key={i} e={e} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
