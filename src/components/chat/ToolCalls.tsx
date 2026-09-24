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
import type { Message, MessageImage } from "@shared/types/chatMessages"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { useBackgroundBash } from "@shared/store/appStore"
import i18n from "@shared/i18n"
import { parseFileChangeResultPayload } from "@shared/utils/resultFormatters"
import { FileChangeView } from "./FileChangeView"
import { isViewImageTool, safeViewImageSource } from "./viewImageSources"

type Entry = {
  id: string
  toolName: string
  params?: Record<string, unknown>
  result?: { text: string; isError: boolean }
  images?: MessageImage[]
  focusedBrowserInput: boolean
  browserSelectOption: boolean
  browserFileInput?: boolean
  browserDialogResponse?: boolean
  browserDialogStatus?: "pending" | "expired" | "unknown"
  browserDownload?: boolean
  browserTool: boolean
  browserEvalTool: boolean
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

const BROWSER_PREVIEW_MAX_LENGTH = 16 * 1024
const BROWSER_DOWNLOAD_RESULT_MAX_LENGTH = 512 * 1024
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

const browserToolName = (toolName: string) =>
  toolName.trim().toLowerCase().split(/__|::|\./).at(-1)

const isBrowserTool = (toolName: string) => browserToolName(toolName) === "browser"
const isBrowserEvalTool = (toolName: string) => browserToolName(toolName) === "browser_eval"

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
  browserSelectOption: boolean
  browserFileInput?: boolean
  browserDialogResponse?: boolean
  browserDownload?: boolean
  browserTool: boolean
  browserEvalTool: boolean
} {
  const browserTool = isBrowserTool(toolName)
  const browserEvalTool = isBrowserEvalTool(toolName)
  // Page scripts, target URLs, and page-realm results can contain private data.
  // Only project a safe status; the underlying message remains unchanged.
  if (browserEvalTool) return { browserTool, browserEvalTool, focusedBrowserInput: false, browserSelectOption: false }
  if (!isRecord(value)) return { browserTool, browserEvalTool, focusedBrowserInput: browserTool, browserSelectOption: false }
  if (!browserTool) return { params: value, browserTool, browserEvalTool, focusedBrowserInput: false, browserSelectOption: false }

  // Persisted malformed arguments arrive as { raw: originalString }. Treat
  // unknown browser arguments as private so a result cannot echo their input.
  let action = ""
  try {
    if ("raw" in value) return { browserTool, browserEvalTool, focusedBrowserInput: true, browserSelectOption: false }
    action = typeof value.action === "string" ? value.action.trim().toLowerCase() : ""
    if (action === "set_file_input") {
      // A valid inline file can exceed the preview limit. Keep its fixed action
      // and status while omitting all bytes and metadata from the display.
      return { browserTool, browserEvalTool, focusedBrowserInput: false, browserSelectOption: false, browserFileInput: true }
    }
    if (action === "dialog_respond") {
      // Dialog text, URL and identity stay in the model's original call only.
      return { browserTool, browserEvalTool, focusedBrowserInput: false, browserSelectOption: false, browserDialogResponse: true }
    }
    if (action === "download") {
      // The result contains base64 bytes. Its filename, selector, and approval
      // resource remain in the model/session record only.
      return { browserTool, browserEvalTool, focusedBrowserInput: false, browserSelectOption: false, browserDownload: true }
    }
    if (action === "select_option") {
      // A valid bounded selection can expand beyond the generic JSON preview
      // limit when its option values need escaping. Keep only its fixed status.
      return { browserTool, browserEvalTool, focusedBrowserInput: false, browserSelectOption: true }
    }
    if (JSON.stringify(value).length > BROWSER_PREVIEW_MAX_LENGTH) {
      return { browserTool, browserEvalTool, focusedBrowserInput: true, browserSelectOption: false }
    }
  } catch {
    return { browserTool, browserEvalTool, focusedBrowserInput: true, browserSelectOption: false }
  }

  const selector = typeof value.selector === "string" && value.selector.trim().length > 0
  const focusedBrowserInput = action === "type" || action === "key" ||
    (action === "press" && !selector && !hasSemanticTarget(value.target))
  if (focusedBrowserInput) {
    // A whitelist keeps text/key and unexpected nested argument fields out of
    // both the collapsed summary and the expanded details.
    return { params: { action }, browserTool, browserEvalTool, focusedBrowserInput, browserSelectOption: false }
  }
  if (!action) return { browserTool, browserEvalTool, focusedBrowserInput: true, browserSelectOption: false }
  return { params: value, browserTool, browserEvalTool, focusedBrowserInput: false, browserSelectOption: false }
}

function browserResultDisplayMetadata(text: string): {
  dialogStatus?: "pending" | "expired" | "unknown"
  parsedRecord: boolean
} {
  // Browser state can include a large DOM. Bound display parsing and never
  // expose action arguments when a result is too large to inspect safely.
  if (text.length > BROWSER_PREVIEW_MAX_LENGTH * 4) return { parsedRecord: false }
  try {
    const result: unknown = JSON.parse(text)
    if (!isRecord(result)) return { parsedRecord: false }
    if (result.pending_dialog == null) return { parsedRecord: true }
    if (!isRecord(result.pending_dialog)) return { parsedRecord: false, dialogStatus: "unknown" }
    return {
      parsedRecord: true,
      dialogStatus: result.pending_dialog.status === "expired" ? "expired" : "pending",
    }
  } catch {
    return { parsedRecord: false }
  }
}

function downloadResultStatus(value: unknown, isError: boolean): string {
  if (isRecord(value) &&
    (value.status === "awaiting_permission_approval" || "permission_request" in value)) {
    return APPROVAL_STATUS
  }
  if (isError) return "网页下载失败"
  return isRecord(value) && typeof value.data_base64 === "string" &&
    typeof value.filename === "string" && typeof value.sha256 === "string" &&
    Number.isSafeInteger(value.byte_count)
    ? "网页下载已完成" : ""
}

function displayResult(entry: Entry, text: string): string {
  if (!text) return entry.browserDownload && entry.result?.isError ? "网页下载失败" : ""
  if (entry.browserDialogResponse || entry.browserDialogStatus) {
    if (text.length > BROWSER_PREVIEW_MAX_LENGTH * 4) {
      return entry.result?.isError ? "网页弹窗操作失败" : "网页弹窗状态待确认"
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return entry.result?.isError ? "网页弹窗操作失败" : "网页弹窗状态待确认"
    }
    if (isRecord(parsed) &&
      (parsed.status === "awaiting_permission_approval" || "permission_request" in parsed)) {
      return APPROVAL_STATUS
    }
    if (entry.result?.isError) return "网页弹窗操作失败"
    if (!isRecord(parsed)) return "网页弹窗状态待确认"
    if (entry.browserDialogStatus === "unknown") return "网页弹窗状态待确认"
    if (entry.browserDialogStatus === "expired") return "网页弹窗已过期"
    if (entry.browserDialogStatus === "pending") return "网页弹窗待处理"
    return "网页弹窗已回应"
  }
  const possiblyApproval = text.includes("awaiting_permission_approval") || text.includes("permission_request")
  if ((entry.browserTool || entry.browserEvalTool || possiblyApproval) && text.length > BROWSER_PREVIEW_MAX_LENGTH) {
    if (entry.browserDownload) {
      if (text.length > BROWSER_DOWNLOAD_RESULT_MAX_LENGTH) return entry.result?.isError ? "网页下载失败" : ""
      try {
        return downloadResultStatus(JSON.parse(text), Boolean(entry.result?.isError))
      } catch {
        return entry.result?.isError ? "网页下载失败" : ""
      }
    }
    if (entry.browserSelectOption && text.length <= BROWSER_PREVIEW_MAX_LENGTH * 4) {
      // Native selection results can exceed the display preview after JSON
      // escaping. Parse only the bounded result envelope, never render it.
      try {
        const parsed = JSON.parse(text)
        if (isRecord(parsed)) {
          if (parsed.status === "awaiting_permission_approval" || "permission_request" in parsed) return APPROVAL_STATUS
          return entry.result?.isError ? "网页选项选择失败" : "网页选项已选择"
        }
      } catch {
        // Malformed results stay hidden rather than gaining a success label.
      }
    }
    return ""
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    if (entry.browserDownload && entry.result?.isError) return "网页下载失败"
    return entry.browserTool || entry.browserEvalTool || possiblyApproval ? "" : text
  }
  if (isRecord(parsed) &&
    (parsed.status === "awaiting_permission_approval" || "permission_request" in parsed)) {
    return APPROVAL_STATUS
  }
  // A restored call can have malformed or missing action arguments while its
  // result still contains a download envelope. Keep that payload private too.
  if (entry.browserTool && !entry.browserFileInput && isRecord(parsed) &&
    ["data_base64", "filename", "byte_count", "sha256"].some((key) => key in parsed)) {
    return downloadResultStatus(parsed, Boolean(entry.result?.isError))
  }
  if (entry.browserEvalTool) return entry.result?.isError ? "网页脚本执行失败" : "网页脚本已执行"
  if (entry.focusedBrowserInput) return entry.result?.isError ? "浏览器输入失败" : "浏览器输入已完成"
  if (entry.browserSelectOption) return entry.result?.isError ? "网页选项选择失败" : "网页选项已选择"
  if (entry.browserFileInput) return entry.result?.isError ? "网页文件设置失败" : "网页文件已设置"
  if (entry.browserDownload) return downloadResultStatus(parsed, Boolean(entry.result?.isError))
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
  if (entry.browserEvalTool) return { label: "执行网页脚本", icon: Globe }
  if (entry.browserDialogResponse) return { label: "回应网页弹窗", icon: Globe }
  if (entry.browserDialogStatus) return { label: "查看网页弹窗", icon: Globe }
  if (entry.browserSelectOption) return { label: "选择网页选项", icon: Globe }
  if (entry.browserFileInput) return { label: "设置网页文件", icon: Globe }
  if (entry.browserDownload) return { label: "下载网页文件", icon: Globe }
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
      : `${uniqueLabels.slice(0, 2).join("、")}等 ${entries.length} 项操作`,
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
  const calls: { id: string; toolName: string; params?: Record<string, unknown>; focusedBrowserInput: boolean; browserSelectOption: boolean; browserFileInput?: boolean; browserDialogResponse?: boolean; browserDownload?: boolean; browserTool: boolean; browserEvalTool: boolean }[] = []
  const results = new Map<string, { text: string; isError: boolean; images?: MessageImage[] }>()
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
        images?: MessageImage[]
      }
      if (r.toolCallId)
        results.set(r.toolCallId, {
          text: typeof r.result?.result === "string" ? r.result.result : "",
          isError: Boolean(r.isError),
          images: r.images,
        })
    }
  }
  return calls.map((c) => {
    const rawResult = results.get(c.id)
    const browserMetadata = c.browserTool && rawResult ? browserResultDisplayMetadata(rawResult.text) : undefined
    const dialogStatus = browserMetadata?.dialogStatus
    const hideBrowserParams = c.browserTool && rawResult && !browserMetadata?.parsedRecord
    const displayEntry = { ...c, browserDialogStatus: dialogStatus, result: rawResult }
    const result = rawResult && {
      isError: rawResult.isError,
      text: displayResult(displayEntry, rawResult.text),
    }
    const background = result ? parseBackgroundBash(result.text) : null
    return {
      id: c.id,
      toolName: c.toolName,
      params: dialogStatus || hideBrowserParams ? undefined : c.params,
      focusedBrowserInput: c.focusedBrowserInput,
      browserSelectOption: c.browserSelectOption,
      browserFileInput: c.browserFileInput,
      browserDialogResponse: c.browserDialogResponse,
      browserDialogStatus: dialogStatus,
      browserDownload: c.browserDownload,
      browserTool: c.browserTool,
      browserEvalTool: c.browserEvalTool,
      result,
      images: isViewImageTool(c.toolName) ? rawResult?.images : undefined,
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

function EntryRow({ e, running, onPreviewImage }: { e: Entry; running: boolean; onPreviewImage?: (src: string) => void }) {
  const [open, setOpen] = useState(false)
  const { primary, rest } = cleanParams(e.params)
  const presentation = presentTool(e)
  const SummaryIcon = presentation.icon
  // File-editing tool results render as a real diff instead of raw JSON.
  const fileChange = open && e.result?.text ? parseFileChangeResultPayload(e.result.text) : null
  const result = open && e.result?.text ? prettyResult(e.result.text) : ""
  const images = open ? e.images?.map(safeViewImageSource).filter((src): src is string => Boolean(src)) : undefined
  return (
    <div data-tool-call-entry className="min-w-0">
      <details open={open}>
        <summary
          data-tool-call-entry-toggle
          aria-expanded={open}
          onClick={(event) => {
            event.preventDefault()
            setOpen(!open)
          }}
          className="flex min-w-0 cursor-pointer list-none items-center gap-1.5 rounded-sm py-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
        >
          <SummaryIcon className="size-3.5 shrink-0" />
          <span className="shrink-0">{presentation.label}</span>
          {presentation.detail ? (
            <span className="min-w-0 truncate font-mono text-xs opacity-70">
              {presentation.detail}
            </span>
          ) : null}
          {e.result?.isError ? <span className="shrink-0 text-destructive">出错</span> : null}
          {e.background ? <BackgroundBadge bashId={e.background.bashId} /> : null}
          {running ? <span className="shrink-0">运行中…</span> : null}
          <ChevronRight className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")} />
        </summary>
        {open ? (
          <div data-tool-call-entry-detail className="mt-1 border-l border-border pl-4 text-[11px]">
            {presentation.label !== e.toolName ? (
              <div className="text-muted-foreground opacity-70">{e.toolName}</div>
            ) : null}
            {images?.length ? (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {images.map((src, index) => (
                  <button key={index} type="button" aria-label={`预览工具图片 ${index + 1}`} className="cursor-zoom-in" onClick={() => onPreviewImage?.(src)}>
                    <img src={src} alt={`工具图片 ${index + 1}`} className="max-h-48 max-w-full rounded-xl object-contain" />
                  </button>
                ))}
              </div>
            ) : null}
            {primary ? (
              <div className="mt-1 line-clamp-3 break-all font-mono text-foreground [overflow-wrap:anywhere]">
                {primary}
              </div>
            ) : null}
            {rest.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
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
              <pre className="mt-1.5 max-h-44 overflow-auto whitespace-pre-wrap break-all text-muted-foreground">
                {result.length > 1000 ? result.slice(0, 1000) + "…" : result}
              </pre>
            ) : null}
          </div>
        ) : null}
      </details>
    </div>
  )
}

/**
 * Keep the group collapsed by default. Opening it reveals every call as one
 * compact action row; each row can then reveal its sanitized details.
 */
type ToolCallsProps = {
  items: Message[]
  active?: boolean
  /** Exact running calls in a live segment, even after partial output arrives. */
  runningCallIds?: ReadonlySet<string>
  /** Optional controlled state, used by virtualized history rows. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onPreviewImage?: (src: string) => void
}

export function ToolCalls({
  items,
  active,
  runningCallIds,
  open: controlledOpen,
  onOpenChange,
  onPreviewImage,
}: ToolCallsProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(next)
    onOpenChange?.(next)
  }

  const entries = buildEntries(items)
  const uniqueNames = Array.from(new Set(entries.map((e) => e.toolName).filter(Boolean)))
  const summary = summarizeEntries(entries)
  const SummaryIcon = active ? Loader2 : summary.icon

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
          <div data-tool-call-panel className="mt-1.5 space-y-1 border-l border-border pl-4 text-xs">
            {entries.map((e) => (
              <EntryRow
                key={e.id}
                e={e}
                running={runningCallIds ? runningCallIds.has(e.id) : Boolean(active && !e.result)}
                onPreviewImage={onPreviewImage}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
