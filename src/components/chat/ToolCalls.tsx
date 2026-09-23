import { useState } from "react"
import {
  ChevronRight,
  FileText,
  Globe,
  Image,
  Loader2,
  Pencil,
  Search,
  Terminal,
  Wrench,
  type LucideIcon,
} from "lucide-react"
import type { Message } from "@shared/types/chatMessages"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { useBackgroundBash } from "@shared/store/appStore"
import i18n from "@shared/i18n"
import { parseFileChangeResultPayload } from "@shared/utils/resultFormatters"
import { FileChangeView } from "./FileChangeView"

type Entry = {
  toolName: string
  params?: Record<string, unknown>
  result?: { text: string; isError: boolean }
  focusedBrowserInput: boolean
  browserTool: boolean
  /** Set when the result marks a background/async shell (see parseBackgroundBash). */
  background?: { bashId: string; command: string }
}

type ToolPresentation = {
  label: string
  icon: LucideIcon
  detail?: string
  multipleLabel?: (count: number) => string
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
const BROWSER_PREVIEW_MAX_LENGTH = 16 * 1024
const APPROVAL_STATUS = "等待用户批准"

// Noisy keys that bloat the display (huge PATH / env dumps) — never shown.
const NOISE_KEYS = new Set(["environment", "env", "cwd", "import_shell", "path_env"])
// The "headline" argument to show prominently, per tool.
const PRIMARY_KEYS = [
  "command",
  "cmd",
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

const compactText = (value: string, maxLength = 72) => {
  const compact = value.replace(/\s+/g, " ").trim()
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}…` : compact
}

const compactPath = (value: string) => {
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "")
  const parts = normalized.split("/").filter(Boolean)
  return compactText(parts.slice(-2).join("/") || normalized)
}

const firstString = (params: Record<string, unknown> | undefined, keys: string[]) => {
  for (const key of keys) {
    const value = params?.[key]
    if (typeof value === "string" && value.trim()) return value
  }
  return undefined
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)

const isBrowserTool = (toolName: string) =>
  toolName.trim().toLowerCase().split(/__|\./).at(-1) === "browser"

const hasSemanticTarget = (value: unknown) => {
  if (!isRecord(value)) return false
  if (value.kind === "role") return typeof value.role === "string" && value.role.trim().length > 0
  if (value.kind === "label" || value.kind === "text") {
    return typeof value.value === "string" && value.value.trim().length > 0
  }
  return false
}

function displayParams(toolName: string, value: unknown): {
  params?: Record<string, unknown>
  focusedBrowserInput: boolean
  browserTool: boolean
} {
  const browserTool = isBrowserTool(toolName)
  if (!isRecord(value)) return { browserTool, focusedBrowserInput: browserTool }
  if (!browserTool) return { params: value, browserTool, focusedBrowserInput: false }

  // Persisted malformed arguments arrive as { raw: originalString }. Treat
  // unknown browser arguments as private so a result cannot echo their input.
  try {
    if ("raw" in value || JSON.stringify(value).length > BROWSER_PREVIEW_MAX_LENGTH) {
      return { browserTool, focusedBrowserInput: true }
    }
  } catch {
    return { browserTool, focusedBrowserInput: true }
  }

  const action = typeof value.action === "string" ? value.action.toLowerCase() : ""
  const selector = typeof value.selector === "string" && value.selector.trim().length > 0
  const focusedBrowserInput = action === "type" || action === "key" ||
    (action === "press" && !selector && !hasSemanticTarget(value.target))
  if (focusedBrowserInput) {
    // A whitelist keeps text/key and unexpected nested argument fields out of
    // both the collapsed summary and the expanded details.
    return { params: { action }, browserTool, focusedBrowserInput }
  }
  if (!action) return { browserTool, focusedBrowserInput: true }
  return { params: value, browserTool, focusedBrowserInput: false }
}

function displayResult(entry: Entry, text: string): string {
  if (!text) return ""
  const possiblyApproval = text.includes("awaiting_permission_approval") || text.includes("permission_request")
  if ((entry.browserTool || possiblyApproval) && text.length > BROWSER_PREVIEW_MAX_LENGTH) return ""

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return entry.browserTool || possiblyApproval ? "" : text
  }
  if (isRecord(parsed) &&
    (parsed.status === "awaiting_permission_approval" || "permission_request" in parsed)) {
    return APPROVAL_STATUS
  }
  if (entry.focusedBrowserInput) return entry.result?.isError ? "浏览器输入失败" : "浏览器输入已完成"
  return entry.browserTool && !isRecord(parsed) ? "" : text
}

const readableToolName = (toolName: string) =>
  toolName
    .replace(/^.*__/, "")
    .replace(/^.*\./, "")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim() || "工具调用"

function presentTool(entry: Entry): ToolPresentation {
  const normalized = entry.toolName.toLowerCase().replace(/[^a-z0-9]+/g, "")
  const path = firstString(entry.params, ["file_path", "path"])
  const command = firstString(entry.params, ["command", "cmd"])
  const query = firstString(entry.params, ["query", "pattern"])

  if (/bashoutput|shelloutput|writestdin/.test(normalized)) {
    return { label: "读取命令输出", icon: Terminal }
  }
  if (/bashinput|shellinput/.test(normalized)) {
    return { label: "向命令发送输入", icon: Terminal }
  }
  if (/killshell|stopcommand|terminateprocess/.test(normalized)) {
    return { label: "停止命令", icon: Terminal }
  }
  if (/bash|execcommand|runshell|terminal/.test(normalized)) {
    return {
      label: "运行命令",
      icon: Terminal,
      detail: command ? compactText(command) : undefined,
      multipleLabel: (count) => `运行 ${count} 个命令`,
    }
  }
  if (/viewimage|openimage|imageview/.test(normalized)) {
    return {
      label: "查看图片",
      icon: Image,
      detail: path ? compactPath(path) : undefined,
      multipleLabel: (count) => `查看 ${count} 张图片`,
    }
  }
  if (/imagegen|generateimage/.test(normalized)) {
    return { label: "生成图片", icon: Image }
  }
  if (
    normalized === "edit" ||
    normalized === "write" ||
    /applypatch|editfile|writefile|notebookedit/.test(normalized)
  ) {
    return {
      label: /notebook/.test(normalized) ? "编辑 Notebook" : "编辑文件",
      icon: Pencil,
      detail: path ? compactPath(path) : undefined,
      multipleLabel: (count) => `编辑 ${count} 个文件`,
    }
  }
  if (/glob|findfiles|listfiles/.test(normalized)) {
    return {
      label: "查找文件",
      icon: Search,
      detail: query ? compactText(query) : undefined,
      multipleLabel: (count) => `执行 ${count} 次文件查找`,
    }
  }
  if (/grep|codesearch|searchcode|rgsearch/.test(normalized)) {
    return {
      label: "搜索代码",
      icon: Search,
      detail: query ? compactText(query) : undefined,
      multipleLabel: (count) => `执行 ${count} 次代码搜索`,
    }
  }
  if (normalized === "read" || /readfile|openfile/.test(normalized)) {
    return {
      label: "读取文件",
      icon: FileText,
      detail: path ? compactPath(path) : undefined,
      multipleLabel: (count) => `读取 ${count} 个文件`,
    }
  }
  if (/webfetch|fetchurl|openurl/.test(normalized)) {
    const url = firstString(entry.params, ["url"])
    return { label: "获取网页", icon: Globe, detail: url ? compactText(url) : undefined }
  }
  if (/websearch|searchweb/.test(normalized)) {
    return { label: "搜索网页", icon: Globe, detail: query ? compactText(query) : undefined }
  }
  if (/sleep|wait/.test(normalized)) {
    return { label: "等待", icon: Wrench }
  }
  if (normalized === "task" || /subagent|spawnagent|delegatetask/.test(normalized)) {
    const description = firstString(entry.params, ["description", "prompt"])
    return { label: "委派任务", icon: Wrench, detail: description ? compactText(description) : undefined }
  }
  if (normalized === "plan" || /updateplan/.test(normalized)) {
    return { label: "更新计划", icon: Wrench }
  }
  if (/getfileinfo|filestat/.test(normalized)) {
    return { label: "查看文件信息", icon: FileText, detail: path ? compactPath(path) : undefined }
  }
  if (/skill/.test(normalized)) {
    return { label: "加载技能", icon: Wrench }
  }
  if (/memory/.test(normalized)) {
    return { label: "查询记忆", icon: Wrench }
  }
  if (/project/.test(normalized)) {
    return { label: "管理项目", icon: Wrench }
  }

  return { label: readableToolName(entry.toolName), icon: Wrench }
}

function summarizeEntries(entries: Entry[]): ToolPresentation {
  if (entries.length === 0) return { label: "工具调用", icon: Wrench }
  const presentations = entries.map(presentTool)
  const uniqueLabels = Array.from(new Set(presentations.map((item) => item.label)))

  if (uniqueLabels.length === 1) {
    const first = presentations[0]
    return {
      ...first,
      label: entries.length > 1 && first.multipleLabel
        ? first.multipleLabel(entries.length)
        : first.label,
      detail: entries.length === 1 ? first.detail : undefined,
    }
  }

  return {
    label: uniqueLabels.length <= 3
      ? uniqueLabels.join("、")
      : `${uniqueLabels.slice(0, 2).join("、")}等 ${uniqueLabels.length} 项操作`,
    icon: presentations[0].icon,
  }
}

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
  const calls: { id: string; toolName: string; params?: Record<string, unknown>; focusedBrowserInput: boolean; browserTool: boolean }[] = []
  const results = new Map<string, { text: string; isError: boolean }>()
  for (const m of items) {
    const t = (m as { type?: string }).type
    if (t === "tool_call") {
      const tcs =
        (m as { toolCalls?: { toolCallId: string; toolName: string; parameters?: unknown }[] })
          .toolCalls ?? []
      for (const tc of tcs)
        calls.push({ id: tc.toolCallId, toolName: tc.toolName, ...displayParams(tc.toolName, tc.parameters) })
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
    const rawResult = results.get(c.id)
    const result = rawResult && {
      isError: rawResult.isError,
      text: displayResult({ ...c, result: rawResult }, rawResult.text),
    }
    const background = result ? parseBackgroundBash(result.text) : null
    return {
      toolName: c.toolName,
      params: c.params,
      focusedBrowserInput: c.focusedBrowserInput,
      browserTool: c.browserTool,
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
  const presentation = presentTool(e)
  // File-editing tool results render as a real diff instead of raw JSON.
  const fileChange = e.result?.text ? parseFileChangeResultPayload(e.result.text) : null
  const result = e.result?.text ? prettyResult(e.result.text) : ""
  return (
    <div data-tool-call-entry className="py-1">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-foreground">{presentation.label}</span>
        {presentation.label !== e.toolName ? (
          <span className="text-[10px] text-muted-foreground opacity-70">{e.toolName}</span>
        ) : null}
        {e.result?.isError ? <span className="text-[10px] text-destructive">出错</span> : null}
        {e.background ? <BackgroundBadge bashId={e.background.bashId} /> : null}
      </div>
      {primary ? (
        <div className="mt-1 line-clamp-3 break-all font-mono text-[11px] text-foreground [overflow-wrap:anywhere]">
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
      {fileChange ? (
        <div className="mt-1.5">
          <FileChangeView payload={fileChange} />
        </div>
      ) : result ? (
        <details className="mt-1.5">
          <summary className="cursor-pointer select-none text-[11px] text-muted-foreground hover:text-foreground">
            结果
          </summary>
          <pre className="mt-1 max-h-44 overflow-auto whitespace-pre-wrap break-all border-l border-border pl-2 text-[11px] text-muted-foreground">
            {result.length > 1000 ? result.slice(0, 1000) + "…" : result}
          </pre>
        </details>
      ) : null}
    </div>
  )
}

/**
 * Compact, balanced tool-call display. Collapsed = a transparent action row
 * with a readable summary and one small identifying detail. Active rounds stay
 * collapsed by default while their spinner remains visible; users can expand a group without streaming updates
 * overriding that choice.
 * To avoid a wall of detail, only the latest {VISIBLE_CAP} tools render expanded
 * — earlier ones fold behind a "展开更早的 N 个" toggle.
 */
type ToolCallsProps = {
  items: Message[]
  active?: boolean
  /** Optional controlled state, used by virtualized history rows. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  showAll?: boolean
  onShowAllChange?: (showAll: boolean) => void
}

export function ToolCalls({
  items,
  active,
  open: controlledOpen,
  onOpenChange,
  showAll: controlledShowAll,
  onShowAllChange,
}: ToolCallsProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const [internalShowAll, setInternalShowAll] = useState(false)
  const open = controlledOpen ?? internalOpen
  const showAll = controlledShowAll ?? internalShowAll
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(next)
    onOpenChange?.(next)
  }
  const setShowAll = (next: boolean) => {
    if (controlledShowAll === undefined) setInternalShowAll(next)
    onShowAllChange?.(next)
  }

  const entries = buildEntries(items)
  const uniqueNames = Array.from(new Set(entries.map((e) => e.toolName).filter(Boolean)))
  const summary = summarizeEntries(entries)
  const SummaryIcon = active ? Loader2 : summary.icon

  const visible = showAll ? entries : entries.slice(-VISIBLE_CAP)
  const hidden = entries.length - visible.length

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[85%]">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          data-tool-call-toggle
          title={uniqueNames.join("、") || undefined}
          className="inline-flex max-w-full items-center gap-1.5 rounded-sm py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <SummaryIcon className={cn("size-3.5 shrink-0", active && "animate-spin")} />
          <span className="truncate">{summary.label}</span>
          {summary.detail ? (
            <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground opacity-70">
              {summary.detail}
            </span>
          ) : null}
          <ChevronRight className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")} />
        </button>

        {open ? (
          <div data-tool-call-panel className="mt-1.5 space-y-2 border-l border-border pl-4 text-xs">
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
