import { FileText, Globe, Image, MessageSquare, Pencil, Search, Terminal, Wrench, type LucideIcon } from "@lucide/solid"
import { uiText } from "@shared/i18n/text"
import type { Message, MessageImage } from "@shared/types/chatMessages"

import { sessionMessagePresentation } from "@/lib/chat/sessionMessagePresentation"
import { isViewImageTool } from "@/lib/chat/viewImageSources"

export type Entry = {
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
export const approvalStatus = () => uiText("waiting_for_your_approval_0dc00a8d")

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
  "message",
  "text",
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
    return approvalStatus()
  }
  if (isError) return uiText("web_download_failed_37881d0e")
  return isRecord(value) && typeof value.data_base64 === "string" &&
    typeof value.filename === "string" && typeof value.sha256 === "string" &&
    Number.isSafeInteger(value.byte_count)
    ? uiText("web_download_completed_f9dd3004") : ""
}

function displayResult(entry: Entry, text: string): string {
  if (!text) return entry.browserDownload && entry.result?.isError ? uiText("web_download_failed_37881d0e") : ""
  if (entry.browserDialogResponse || entry.browserDialogStatus) {
    if (text.length > BROWSER_PREVIEW_MAX_LENGTH * 4) {
      return entry.result?.isError ? uiText("web_dialog_action_failed_496f20bd") : uiText("web_dialog_state_unconfirmed_511c7de0")
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return entry.result?.isError ? uiText("web_dialog_action_failed_496f20bd") : uiText("web_dialog_state_unconfirmed_511c7de0")
    }
    if (isRecord(parsed) &&
      (parsed.status === "awaiting_permission_approval" || "permission_request" in parsed)) {
      return approvalStatus()
    }
    if (entry.result?.isError) return uiText("web_dialog_action_failed_496f20bd")
    if (!isRecord(parsed)) return uiText("web_dialog_state_unconfirmed_511c7de0")
    if (entry.browserDialogStatus === "unknown") return uiText("web_dialog_state_unconfirmed_511c7de0")
    if (entry.browserDialogStatus === "expired") return uiText("web_dialog_expired_33cf66ef")
    if (entry.browserDialogStatus === "pending") return uiText("web_dialog_awaiting_response_9f92f02b")
    return uiText("web_dialog_answered_2de9a678")
  }
  const possiblyApproval = text.includes("awaiting_permission_approval") || text.includes("permission_request")
  if ((entry.browserTool || entry.browserEvalTool || possiblyApproval) && text.length > BROWSER_PREVIEW_MAX_LENGTH) {
    if (entry.browserDownload) {
      if (text.length > BROWSER_DOWNLOAD_RESULT_MAX_LENGTH) return entry.result?.isError ? uiText("web_download_failed_37881d0e") : ""
      try {
        return downloadResultStatus(JSON.parse(text), Boolean(entry.result?.isError))
      } catch {
        return entry.result?.isError ? uiText("web_download_failed_37881d0e") : ""
      }
    }
    if (entry.browserSelectOption && text.length <= BROWSER_PREVIEW_MAX_LENGTH * 4) {
      // Native selection results can exceed the display preview after JSON
      // escaping. Parse only the bounded result envelope, never render it.
      try {
        const parsed = JSON.parse(text)
        if (isRecord(parsed)) {
          if (parsed.status === "awaiting_permission_approval" || "permission_request" in parsed) return approvalStatus()
          return entry.result?.isError ? uiText("web_option_selection_failed_54027654") : uiText("web_options_selected_9d95e309")
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
    if (entry.browserDownload && entry.result?.isError) return uiText("web_download_failed_37881d0e")
    return entry.browserTool || entry.browserEvalTool || possiblyApproval ? "" : text
  }
  if (isRecord(parsed) &&
    (parsed.status === "awaiting_permission_approval" || "permission_request" in parsed)) {
    return approvalStatus()
  }
  // A restored call can have malformed or missing action arguments while its
  // result still contains a download envelope. Keep that payload private too.
  if (entry.browserTool && !entry.browserFileInput && isRecord(parsed) &&
    ["data_base64", "filename", "byte_count", "sha256"].some((key) => key in parsed)) {
    return downloadResultStatus(parsed, Boolean(entry.result?.isError))
  }
  if (entry.browserEvalTool) return entry.result?.isError ? uiText("web_script_execution_failed_742c4b84") : uiText("web_script_executed_ede4f7a6")
  if (entry.focusedBrowserInput) return entry.result?.isError ? uiText("browser_input_failed_0a04106d") : uiText("browser_input_completed_f26de380")
  if (entry.browserSelectOption) return entry.result?.isError ? uiText("web_option_selection_failed_54027654") : uiText("web_options_selected_9d95e309")
  if (entry.browserFileInput) return entry.result?.isError ? uiText("web_file_selection_failed_ddd93cab") : uiText("web_files_selected_beb60ad8")
  if (entry.browserDownload) return downloadResultStatus(parsed, Boolean(entry.result?.isError))
  return entry.browserTool && !isRecord(parsed) ? "" : text
}

const readableToolName = (toolName: string) =>
  toolName
    .replace(/^.*__/, "")
    .replace(/^.*\./, "")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim() || uiText("tool_calls_a8ca3c13")

export function presentTool(entry: Entry): ToolPresentation {
  const message = sessionMessagePresentation(entry.toolName, entry.params, entry.result)
  if (message) return { label: message.label, detail: message.status, icon: MessageSquare }
  if (entry.browserEvalTool) return { label: uiText("execute_web_script_f9a5ccf3"), icon: Globe }
  if (entry.browserDialogResponse) return { label: uiText("respond_to_web_dialog_e0f2f248"), icon: Globe }
  if (entry.browserDialogStatus) return { label: uiText("view_web_dialog_b07d2b63"), icon: Globe }
  if (entry.browserSelectOption) return { label: uiText("select_web_options_4ddab1c1"), icon: Globe }
  if (entry.browserFileInput) return { label: uiText("set_web_files_a87e70ca"), icon: Globe }
  if (entry.browserDownload) return { label: uiText("download_web_file_68532ddc"), icon: Globe }
  const normalized = entry.toolName.toLowerCase().replace(/[^a-z0-9]+/g, "")
  const path = firstString(entry.params, ["file_path", "path"])
  const command = firstString(entry.params, ["command", "cmd"])
  const query = firstString(entry.params, ["query", "pattern"])

  if (/bashoutput|shelloutput|writestdin/.test(normalized)) {
    return { label: uiText("read_command_output_dd7e06ae"), icon: Terminal }
  }
  if (/bashinput|shellinput/.test(normalized)) {
    return { label: uiText("send_command_input_8fc6194d"), icon: Terminal }
  }
  if (/killshell|stopcommand|terminateprocess/.test(normalized)) {
    return { label: uiText("stop_command_b116ef12"), icon: Terminal }
  }
  if (/bash|execcommand|runshell|terminal/.test(normalized)) {
    return {
      label: uiText("run_command_e53f35dc"),
      icon: Terminal,
      detail: command ? compactText(command) : undefined,
    }
  }
  if (/viewimage|openimage|imageview/.test(normalized)) {
    return {
      label: uiText("view_image_a9769c63"),
      icon: Image,
      detail: path ? compactPath(path) : undefined,
    }
  }
  if (/imagegen|generateimage/.test(normalized)) {
    return { label: uiText("generate_image_71c9cf3d"), icon: Image }
  }
  if (
    normalized === "edit" ||
    normalized === "write" ||
    /applypatch|editfile|writefile|notebookedit/.test(normalized)
  ) {
    return {
      label: /notebook/.test(normalized) ? uiText("edit_notebook_3ee5f852") : uiText("edit_file_60ed2653"),
      icon: Pencil,
      detail: path ? compactPath(path) : undefined,
    }
  }
  if (/glob|findfiles|listfiles/.test(normalized)) {
    return {
      label: uiText("find_files_51fdfeaa"),
      icon: Search,
      detail: query ? compactText(query) : undefined,
    }
  }
  if (/grep|codesearch|searchcode|rgsearch/.test(normalized)) {
    return {
      label: uiText("search_code_562834f5"),
      icon: Search,
      detail: query ? compactText(query) : undefined,
    }
  }
  if (normalized === "read" || /readfile|openfile/.test(normalized)) {
    return {
      label: uiText("read_file_407dd16f"),
      icon: FileText,
      detail: path ? compactPath(path) : undefined,
    }
  }
  if (/webfetch|fetchurl|openurl/.test(normalized)) {
    const url = firstString(entry.params, ["url"])
    return { label: uiText("fetch_page_943f1f86"), icon: Globe, detail: url ? compactText(url) : undefined }
  }
  if (/websearch|searchweb/.test(normalized)) {
    return { label: uiText("search_web_01aeaf3f"), icon: Globe, detail: query ? compactText(query) : undefined }
  }
  if (/sleep|wait/.test(normalized)) {
    return { label: uiText("wait_251bc40e"), icon: Wrench }
  }
  if (normalized === "task" || /subagent|spawnagent|delegatetask/.test(normalized)) {
    const description = firstString(entry.params, ["description", "prompt"])
    return { label: uiText("delegate_task_5161967c"), icon: Wrench, detail: description ? compactText(description) : undefined }
  }
  if (normalized === "plan" || /updateplan/.test(normalized)) {
    return { label: uiText("update_plan_c9388382"), icon: Wrench }
  }
  if (/getfileinfo|filestat/.test(normalized)) {
    return { label: uiText("view_file_information_a5d09268"), icon: FileText, detail: path ? compactPath(path) : undefined }
  }
  if (/skill/.test(normalized)) {
    return { label: uiText("load_skill_11ff0491"), icon: Wrench }
  }
  if (/memory/.test(normalized)) {
    return { label: uiText("query_memory_6c9164f7"), icon: Wrench }
  }
  if (/project/.test(normalized)) {
    return { label: uiText("manage_projects_302f96cf"), icon: Wrench }
  }

  return { label: readableToolName(entry.toolName), icon: Wrench }
}

export function cleanParams(params?: Record<string, unknown>): {
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
    rest.push([k, val])
  }
  return { primary, rest }
}

// Strip noisy keys from a JSON-shaped tool result and pretty-print it; plain
// text passes through.
export function prettyResult(text: string): string {
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

export function buildEntries(items: Message[]): Entry[] {
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
        result?: { result?: string; display_preference?: string }
        images?: MessageImage[]
      }
      if (r.toolCallId)
        results.set(r.toolCallId, {
          text: r.result?.display_preference !== "Hidden" && typeof r.result?.result === "string" ? r.result.result : "",
          isError: Boolean(r.isError),
          images: r.result?.display_preference !== "Hidden" ? r.images : undefined,
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
