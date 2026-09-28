import { apiClient } from "../api"
import { isApiError } from "../api/errors"

export type WorkflowSource = "builtin" | "project" | "workspace" | "user" | "plugin"
export type WorkflowSelection = { id: string; source: WorkflowSource; revision: number; args: unknown }
export type WorkflowCatalogEntry = {
  id: string; name: string; description: string
  kind: "instruction" | "orchestration"; source: WorkflowSource; revision: number
  status: "valid" | "invalid"; winner: boolean
  invocation_policy: Record<string, unknown>; argument_schema: Record<string, unknown>
  last_error?: string
}
export type WorkflowCatalog = { revision: number; entries: WorkflowCatalogEntry[] }
export type TypedWorkflowDraft = { entry: WorkflowCatalogEntry; argsText: string }

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
const owns = (value: Record<string, unknown>, key: string) => Object.hasOwn(value, key)
const sources: readonly unknown[] = ["builtin", "project", "workspace", "user", "plugin"]
const types = ["null", "boolean", "object", "array", "number", "integer", "string"]
const keywords = ["type", "enum", "required", "properties", "additionalProperties", "items", "minimum", "maximum", "x-bamboo-secret"]

// Matches Bamboo domain/workflow/schema.rs, including its intentionally small
// supported vocabulary. The backend still validates the pinned definition.
export function validateWorkflowSchema(schema: unknown, depth = 0): asserts schema is Record<string, unknown> {
  if (!object(schema) || depth > 64) throw new Error("Workflow 参数 schema 无效或嵌套过深")
  if (Object.keys(schema).some((key) => !keywords.includes(key))) throw new Error("Workflow 参数 schema 含不支持的字段")
  if (owns(schema, "type")) {
    const kinds = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!kinds.length || kinds.some((kind) => typeof kind !== "string" || !types.includes(kind))) throw new Error("Workflow 参数 schema type 无效")
  }
  if (owns(schema, "enum") && !Array.isArray(schema.enum)) throw new Error("Workflow 参数 enum 无效")
  if (owns(schema, "required") && (!Array.isArray(schema.required) || schema.required.some((key) => typeof key !== "string"))) throw new Error("Workflow 参数 required 无效")
  for (const key of ["additionalProperties", "x-bamboo-secret"]) {
    if (owns(schema, key) && typeof schema[key] !== "boolean") throw new Error(`Workflow 参数 ${key} 无效`)
  }
  for (const key of ["minimum", "maximum"]) {
    if (owns(schema, key) && (typeof schema[key] !== "number" || !Number.isFinite(schema[key]))) throw new Error(`Workflow 参数 ${key} 无效`)
  }
  if (owns(schema, "properties")) {
    if (!object(schema.properties)) throw new Error("Workflow 参数 properties 无效")
    Object.values(schema.properties).forEach((child) => validateWorkflowSchema(child, depth + 1))
  }
  if (owns(schema, "items")) validateWorkflowSchema(schema.items, depth + 1)
}

function equalJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, i) => equalJson(value, b[i]))
  if (object(a) && object(b)) return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((key) => owns(b, key) && equalJson(a[key], b[key]))
  return false
}
function matchesType(kind: unknown, value: unknown): boolean {
  switch (kind) {
    case "null": return value === null
    case "boolean": return typeof value === "boolean"
    case "object": return object(value)
    case "array": return Array.isArray(value)
    case "number": return typeof value === "number" && Number.isFinite(value)
    case "integer": return typeof value === "number" && Number.isSafeInteger(value)
    case "string": return typeof value === "string"
    default: return false
  }
}
function validateArgs(schema: Record<string, unknown>, value: unknown, path = "$"): void {
  if (schema["x-bamboo-secret"] === true) {
    if (!object(value) || Object.keys(value).length !== 1 || typeof value.$secret !== "string" || !value.$secret.trim()) throw new Error(`${path}: 需要 $secret capability handle`)
    return
  }
  if (owns(schema, "type")) {
    const kinds = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!kinds.some((kind) => matchesType(kind, value))) throw new Error(`${path}: 参数类型不匹配`)
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((choice) => equalJson(choice, value))) throw new Error(`${path}: 参数不在 enum 中`)
  if (Array.isArray(schema.required)) {
    if (!object(value)) throw new Error(`${path}: required 需要 object`)
    for (const key of schema.required as string[]) if (!owns(value, key)) throw new Error(`${path}: 缺少必填参数 ${key}`)
  }
  if (object(value)) {
    const properties = object(schema.properties) ? schema.properties : {}
    for (const [key, child] of Object.entries(value)) {
      if (owns(properties, key)) validateArgs(properties[key] as Record<string, unknown>, child, `${path}/${key}`)
      else if (schema.additionalProperties === false) throw new Error(`${path}: 不允许参数 ${key}`)
    }
  }
  if (Array.isArray(value) && object(schema.items)) value.forEach((child, i) => validateArgs(schema.items as Record<string, unknown>, child, `${path}/${i}`))
  for (const [key, valid] of [["minimum", (a: number, b: number) => a >= b], ["maximum", (a: number, b: number) => a <= b]] as const) {
    if (typeof schema[key] === "number" && (typeof value !== "number" || !valid(value, schema[key]))) throw new Error(`${path}: 参数不符合 ${key}`)
  }
}

export function parseWorkflowCatalog(value: unknown): WorkflowCatalog {
  if (!object(value) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0 || !Array.isArray(value.entries)) throw new Error("Bamboo Workflow 目录格式无效")
  const entries = value.entries.map((raw) => {
    if (!object(raw) || typeof raw.id !== "string" || !raw.id.trim() || typeof raw.name !== "string" || !raw.name.trim() || typeof raw.description !== "string"
      || !["instruction", "orchestration"].includes(raw.kind as string) || !sources.includes(raw.source)
      || !Number.isSafeInteger(raw.revision) || (raw.revision as number) < 0 || !["valid", "invalid"].includes(raw.status as string)
      || typeof raw.winner !== "boolean" || !object(raw.invocation_policy) || (owns(raw.invocation_policy, "explicit") && typeof raw.invocation_policy.explicit !== "boolean")
      || (raw.last_error !== undefined && typeof raw.last_error !== "string")) throw new Error("Bamboo Workflow 条目格式无效")
    // Invalid entries retain diagnostics, but cannot become typed selections.
    if (raw.status === "valid") validateWorkflowSchema(raw.argument_schema)
    if (!object(raw.argument_schema)) throw new Error("Bamboo Workflow 参数 schema 格式无效")
    return { id: raw.id, name: raw.name, description: raw.description, kind: raw.kind,
      source: raw.source, revision: raw.revision, status: raw.status, winner: raw.winner,
      invocation_policy: raw.invocation_policy, argument_schema: raw.argument_schema,
      ...(raw.last_error === undefined ? {} : { last_error: raw.last_error }) } as WorkflowCatalogEntry
  })
  return { revision: value.revision as number, entries }
}

export function workflowUnavailableReason(entry: WorkflowCatalogEntry): string | null {
  if (entry.status !== "valid") return entry.last_error || "定义无效"
  if (!entry.winner) return "不是当前生效的来源"
  if (entry.revision <= 0) return "缺少可发送的 revision"
  if (entry.kind !== "instruction") return "编排型 Workflow 需要 Workflow Run API"
  if (entry.invocation_policy.explicit !== true) return "不允许显式选择"
  return null
}

export function prepareWorkflowSelection(draft: TypedWorkflowDraft): WorkflowSelection {
  const reason = workflowUnavailableReason(draft.entry)
  if (reason) throw new Error(reason)
  validateWorkflowSchema(draft.entry.argument_schema)
  let args: unknown
  try { args = JSON.parse(draft.argsText) } catch { throw new Error("Workflow 参数必须是有效 JSON") }
  // JSON.parse can produce Infinity or round integers before HTTP JSON
  // encoding. Reject them even when the catalog has an unconstrained schema.
  const pending = [args]
  while (pending.length) {
    const value = pending.pop()
    if (typeof value === "number" && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) throw new Error("Workflow 参数数值必须有限，整数必须在 JavaScript 安全范围内")
    if (Array.isArray(value)) for (const child of value) pending.push(child)
    else if (object(value)) for (const child of Object.values(value)) pending.push(child)
  }
  validateArgs(draft.entry.argument_schema, args)
  return { id: draft.entry.id, source: draft.entry.source, revision: draft.entry.revision, args }
}

export async function getWorkflowCatalog(sessionId: string | null, signal?: AbortSignal): Promise<WorkflowCatalog> {
  const query = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ""
  return parseWorkflowCatalog(await apiClient.get<unknown>(`/bamboo/workflow-catalog${query}`, { signal }))
}

export function workflowSubmissionError(error: unknown): { code: string; message: string } | null {
  if (!isApiError(error) || !error.body) return null
  try {
    const body = JSON.parse(error.body) as { error?: { code?: unknown; message?: unknown } }
    const code = body.error?.code
    if (typeof code !== "string" || (!code.startsWith("workflow_") && code !== "root_orchestration_incompatible_mode")) return null
    return { code, message: typeof body.error?.message === "string" ? body.error.message : error.message }
  } catch { return null }
}
